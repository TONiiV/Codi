import { AuthSessionId, type ProjectId, Telescope } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT } from "../../auth/EnvironmentAuth.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import { UsageProjectResolver } from "../../usage/UsageProjectResolver.ts";
import { listTranscriptFiles } from "../../usage/usageTranscriptReader.ts";
import * as TaskBoardService from "../TaskBoardService.ts";
import * as WorkspaceService from "../WorkspaceService.ts";
import {
  brokenCachePrefix,
  type ConfigChange,
  oversizedToolOutputs,
  repeatedReads,
} from "./analyzers.ts";
import { makeSessionCollector, readLines, type SessionActivity } from "./claudeSessions.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const AGENT_ID = "telescope.tokensaver";
const PREFIX_FILES = ["CLAUDE.md", "AGENTS.md", ".mcp.json"];
const PATTERN_LABELS: Record<Telescope.TokenSaverPattern, string> = {
  broken_cache_prefix: "缓存前缀被打断",
  repeated_reads: "同一文件反复读",
  oversized_tool_outputs: "巨大的工具输出",
};
const TOKEN = " token";
const TIMES = " 次";
/** Evidence key to its label and the unit that follows the number: "共计 35K token". */
const EVIDENCE_LABELS: Readonly<Record<string, readonly [label: string, unit?: string]>> = {
  sessions: ["统计的会话"],
  outlierSessions: ["缓存写入异常的会话"],
  sessionsWithConfigChange: ["期间改过配置文件的会话"],
  medianCacheWriteRatio: ["缓存写入比例中位数"],
  excessCacheWriteTokens: ["多写入的缓存", TOKEN],
  changedFiles: ["改过的文件"],
  repeatedReads: ["重复读取", TIMES],
  repeatedReadTokens: ["重复读取共计", TOKEN],
  sessionFilePairs: ["涉及的智能体和文件组合"],
  topFile: ["重复最多的文件"],
  topFileRepeatsInOneSession: ["该文件在一个智能体里重复读", TIMES],
  oversizedResults: ["超过阈值的结果", TIMES],
  oversizedResultTokens: ["这些结果共计", TOKEN],
  topToolThresholdTokens: ["主要工具的阈值", TOKEN],
  topTool: ["主要来自"],
  topToolResults: ["主要工具超过阈值", TIMES],
};
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const CONFIDENCE_LABELS = { high: "高", medium: "中", low: "低" } as const;
const SAVING_LABELS: Record<Telescope.TokenSaverFinding["savingKind"], (tokens: string) => string> =
  {
    tokens: (tokens) => `约 ${tokens} token`,
    cost: (tokens) => `约 ${tokens} token 从缓存写入改为缓存读取，省费用不省 token`,
  };
const OPTIONS = [
  { id: "execute", label: "执行" },
  { id: "trial", label: "先试一周" },
  { id: "ignore", label: "忽略" },
];
// The weekly job acts as the environment owner, an admin of every workspace here.
const ENVIRONMENT_OWNER: WorkspaceService.Caller = {
  sessionId: AuthSessionId.make(AGENT_ID),
  subject: INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT,
};

// A decision's text is the report markdown, then its data as a fenced JSON block, so a rerun can
// return the stored report exactly as the first run did.
const StoredReport = Schema.Struct({
  since: Telescope.TokenSaverReport.fields.since,
  until: Telescope.TokenSaverReport.fields.until,
  sessionsAnalyzed: Telescope.TokenSaverReport.fields.sessionsAnalyzed,
  findings: Telescope.TokenSaverReport.fields.findings,
  quality: Telescope.TokenSaverReport.fields.quality,
});
const encodeStoredReport = Schema.encodeSync(Schema.fromJsonString(StoredReport));
const decodeStoredReport = Schema.decodeUnknownOption(Schema.fromJsonString(StoredReport));
const STORED_REPORT_BLOCK = /^([\s\S]*?)\n\n```json\n([\s\S]*)\n```$/;
/** `None` for a decision written before the data block held the whole report. */
const decodeDecisionText = (text: string) => {
  const [, markdown = "", json = ""] = STORED_REPORT_BLOCK.exec(text) ?? [];
  return Option.map(decodeStoredReport(json), (stored) => ({ ...stored, markdown }));
};
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const metric = (value: number | null) => (value === null ? "未测量" : String(value));

/** Cost savings first, then token savings; each by estimated saving. */
export const rankFindings = (a: Telescope.TokenSaverFinding, b: Telescope.TokenSaverFinding) =>
  Number(b.savingKind === "cost") - Number(a.savingKind === "cost") ||
  b.estimatedSavingTokens - a.estimatedSavingTokens;

const renderMarkdown = (report: Omit<Telescope.TokenSaverReport, "markdown">) => {
  const lines = [
    `# 省 token 周报 ${report.since.slice(0, 10)} 至 ${report.until.slice(0, 10)}`,
    "",
    `分析了 ${report.sessionsAnalyzed} 个 Claude 会话（含子智能体）。只统计在 Codi 线程中运行的会话，其他 provider 暂不支持。`,
    "节省数字是估算，先列省费用的，再列省 token 的，各自按预计节省排序。",
  ];
  for (const [index, finding] of report.findings.entries()) {
    const evidence = Object.entries(finding.evidence).map(([key, value]) => {
      const [label, unit = ""] = EVIDENCE_LABELS[key] ?? [key];
      return `${label} ${unit && typeof value === "number" ? compact.format(value) : value}${unit}`;
    });
    lines.push(
      "",
      `## ${index + 1}. ${PATTERN_LABELS[finding.pattern]}`,
      `- 证据：${evidence.join("，")}`,
      `- 预计省：${SAVING_LABELS[finding.savingKind](compact.format(finding.estimatedSavingTokens))}，把握${CONFIDENCE_LABELS[finding.confidence]}`,
      `- 建议：${finding.suggestion}`,
    );
  }
  if (report.findings.length === 0) lines.push("", "本周没有发现这三种浪费模式。");
  lines.push(
    "",
    "## 质量指标",
    `- 测试通过率：${metric(report.quality.testPassRate)}`,
    `- 用户追问次数：${metric(report.quality.followUpPrompts)}`,
    `- 回滚次数：${metric(report.quality.rollbacks)}`,
  );
  return lines.join("\n");
};

/** The weekly token-saver report: reads local transcripts, proposes changes, never applies them. */
export class TokenSaverService extends Context.Service<
  TokenSaverService,
  {
    readonly runWeekly: (
      actor: TaskBoardService.Actor,
      input: typeof Telescope.TokenSaverRunInput.Type,
    ) => Effect.Effect<
      Telescope.TokenSaverReport,
      Effect.Error<ReturnType<TaskBoardService.TaskBoardService["Service"]["createDecision"]>>
    >;
  }
>()("t3/telescope/tokensaver/TokenSaverService") {}

const make = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const board = yield* TaskBoardService.TaskBoardService;
  const resolver = yield* UsageProjectResolver;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readSessions = Effect.fn("TokenSaverService.readSessions")(function* (
    projects: ReadonlySet<ProjectId>,
    window: { readonly sinceMs: number; readonly untilMs: number },
  ) {
    const env = yield* HostProcess.Environment;
    const home =
      env["CLAUDE_CONFIG_DIR"]?.trim() || path.join(yield* HostProcess.HomeDirectory, ".claude");
    const { files } = yield* Effect.promise(() =>
      listTranscriptFiles(path.join(home, "projects"), window.sinceMs),
    );
    // Claude Code names a transcript after its session id. A resumed session can leave one in
    // each project directory it ran in; subagents write `<session>/subagents/agent-*.jsonl`.
    const bySession = new Map<string, Array<string>>();
    for (const { path: file } of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId =
        path.basename(path.dirname(file)) === "subagents"
          ? path.basename(path.dirname(path.dirname(file)))
          : path.basename(file, ".jsonl");
      bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), file]);
    }
    const owners = yield* resolver.resolve(new Set(bySession.keys()));
    const collector = makeSessionCollector(window);
    for (const [sessionId, sessionFiles] of bySession) {
      const owner = owners.get(sessionId);
      if (owner === undefined || !projects.has(owner)) continue;
      for (const file of sessionFiles)
        if (!(yield* Effect.promise(() => readLines(file, collector.add))))
          yield* Effect.logWarning("Token saver could not read a transcript", { file });
    }
    return collector.sessions().filter((session) => owners.has(session.sessionId));
  });

  const configChanges = (sessions: ReadonlyArray<SessionActivity>) =>
    Effect.forEach(
      [...new Set(sessions.map(({ cwd }) => cwd))].flatMap((cwd) =>
        cwd === "" ? [] : PREFIX_FILES.map((file) => ({ cwd, file })),
      ),
      ({ cwd, file }) =>
        fileSystem.stat(path.join(cwd, file)).pipe(
          Effect.map((info): ReadonlyArray<ConfigChange> =>
            Option.match(info.mtime, {
              onNone: () => [],
              onSome: (mtime) => [{ cwd, file, mtimeMs: mtime.getTime() }],
            }),
          ),
          Effect.orElseSucceed(() => []),
        ),
    ).pipe(Effect.map((changes) => changes.flat()));

  const runWeekly = Effect.fn("TokenSaverService.runWeekly")(function* (
    actor: TaskBoardService.Actor,
    { workspaceId, ...window }: typeof Telescope.TokenSaverRunInput.Type,
  ) {
    const untilMs =
      window.until === undefined ? yield* Clock.currentTimeMillis : Date.parse(window.until);
    const sinceMs = window.since === undefined ? untilMs - WEEK_MS : Date.parse(window.since);
    if (!(sinceMs < untilMs))
      return yield* new Telescope.WorkspaceError({
        reason: "conflict",
        message: "The report window is empty.",
      });
    const environmentId = yield* environment.getEnvironmentId;
    const { bindings } = yield* workspaces.bindings(actor.caller, { workspaceId });
    const projects = new Set(
      bindings
        .filter((binding) => binding.environmentId === environmentId)
        .map(({ projectId }) => projectId),
    );
    // A proposal nobody has decided yet is the report for this workspace (D31): skip the transcripts.
    const { decisions } = yield* board.listDecisions(actor, { workspaceId });
    const open = decisions.find(
      ({ authorId, status }) => authorId === AGENT_ID && status === "proposed",
    );
    if (open !== undefined)
      return {
        workspaceId,
        ...Option.getOrElse(decodeDecisionText(open.text), () => ({
          since: iso(sinceMs),
          until: iso(untilMs),
          sessionsAnalyzed: 0,
          findings: [],
          quality: { testPassRate: null, followUpPrompts: null, rollbacks: null },
          markdown: open.text,
        })),
        decisionId: open.id,
      };
    const sessions = projects.size === 0 ? [] : yield* readSessions(projects, { sinceMs, untilMs });
    const changes = yield* configChanges(sessions);
    const findings = [
      brokenCachePrefix(sessions, changes),
      repeatedReads(sessions),
      oversizedToolOutputs(sessions),
    ]
      .filter((finding) => finding !== undefined)
      .toSorted(rankFindings);
    const body = {
      workspaceId,
      since: iso(sinceMs),
      until: iso(untilMs),
      sessionsAnalyzed: sessions.length,
      findings,
      quality: {
        testPassRate: null,
        followUpPrompts: sessions.reduce(
          (sum, { userPrompts }) => sum + Math.max(0, userPrompts - 1),
          0,
        ),
        rollbacks: null,
      },
    };
    const report = { ...body, markdown: renderMarkdown(body) };
    if (findings.length === 0) return report;
    const decision = yield* board.createDecision(
      { ...actor, authorId: AGENT_ID },
      {
        workspaceId,
        title: `省 token 周报 ${body.since.slice(0, 10)} 至 ${body.until.slice(0, 10)}`,
        text: `${report.markdown}\n\n\`\`\`json\n${encodeStoredReport(body)}\n\`\`\``,
        status: "proposed",
        options: OPTIONS,
      },
    );
    return { ...report, decisionId: decision.id };
  });

  return TokenSaverService.of({ runWeekly });
});

export const layer = Layer.effect(TokenSaverService, make).pipe(
  Layer.provide(Layer.merge(TaskBoardService.layer, WorkspaceService.layer)),
);

/** One pass of the weekly job: reports every workspace whose last report is a week old. */
export const makeWeeklyPass = Effect.gen(function* () {
  const tokenSaver = yield* TokenSaverService;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const board = yield* TaskBoardService.TaskBoardService;
  const actor = { caller: ENVIRONMENT_OWNER };
  const lastRun = new Map<Telescope.WorkspaceId, number>();
  let nextCheckMs = 0;
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (now < nextCheckMs) return;
    nextCheckMs = now + CHECK_INTERVAL_MS;
    const { workspaces: all } = yield* workspaces.list(ENVIRONMENT_OWNER, {});
    yield* Effect.forEach(
      all,
      ({ id: workspaceId }) =>
        Effect.gen(function* () {
          const { decisions } = yield* board.listDecisions(actor, { workspaceId });
          const reported = decisions
            .filter(({ authorId }) => authorId === AGENT_ID)
            .map(({ createdAt }) => Date.parse(createdAt));
          const last = Math.max(lastRun.get(workspaceId) ?? 0, ...reported);
          if (now - last < WEEK_MS) return;
          lastRun.set(workspaceId, now);
          yield* tokenSaver.runWeekly(actor, { workspaceId, until: iso(now) });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Token saver report failed", { workspaceId, cause }),
          ),
        ),
      { discard: true },
    );
  });
});

export const layerWeekly = Layer.effectDiscard(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register(AGENT_ID, yield* makeWeeklyPass);
  }),
).pipe(
  Layer.provide(Layer.mergeAll(TaskBoardService.layer, WorkspaceService.layer, Scheduler.layer)),
);
