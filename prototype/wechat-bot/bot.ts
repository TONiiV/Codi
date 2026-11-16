// PROTOTYPE, throwaway ("wipe me"). WeChat ClawBot <-> Codi bridge.
// Run: bun prototype/wechat-bot/bot.ts [--transport=cli|weixin|wecom] [--login] [--config=path] [--state=dir]
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as ilink from "./ilink.ts";
import * as wecom from "./wecom.ts";

const DIR = import.meta.dir;
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const STATE_DIR = flag("state") ?? join(DIR, ".state");
mkdirSync(STATE_DIR, { recursive: true });
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "bun prototype/wechat-bot/bot.ts [--transport=cli|weixin|wecom] [--login] [--config=path] [--state=dir]\nconfig: .state/config.json (falls back to config.example.json)",
  );
  process.exit(0);
}
const login = args.includes("--login");
const transport = flag("transport") ?? (login ? "weixin" : "cli");

// ---------- config + persisted state ----------
type Env = { id: string; label: string; url: string; pairingUrl?: string; token?: string };
type ModelSel = {
  instanceId: string;
  model: string;
  options?: { id: string; value: string | boolean }[];
};
type Access = "read" | "write";
/** projectId "*" = every project in that environment (admin convenience). Grants are the ONLY source of visibility. */
type Grant = { environmentId: string; projectId: string; title?: string; access: Access };
type Work = { environmentId?: string; modelSelection: ModelSel; lockModel?: boolean };
type Member = { id: string; name: string; role: "admin" | "member"; grants: Grant[]; work: Work };
type Config = {
  assistant: { command: string[] };
  environments: Env[];
  /** seeds members.json only when it does not exist yet */
  admins?: string[];
  bootstrapCode?: string;
  defaultWork: Work;
  wecom?: { botId: string; secret: string; url?: string };
};

const cfgPath =
  flag("config") ??
  (existsSync(join(STATE_DIR, "config.json"))
    ? join(STATE_DIR, "config.json")
    : join(DIR, "config.example.json"));
const cfg: Config = JSON.parse(readFileSync(cfgPath, "utf8"));
console.log(`[boot] config=${cfgPath} transport=${transport}`);

const statePath = join(STATE_DIR, "state.json");
const state: {
  bearers: Record<string, string>;
  ctx: Record<string, { account: string; contextToken?: string }>;
} = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { bearers: {}, ctx: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

// ---------- members / channel accounts / invites (persisted: admin edits from chat survive restart) ----------
/** account = `<channel>:<native id>` (weixin:<from_user_id>, wecom:<userid>, cli:<name>); each maps to exactly one member. */
type Store = {
  members: Record<string, Member>;
  accounts: Record<string, string>;
  invites: Record<string, { memberId?: string; bootstrap?: boolean; exp?: number }>;
};
const storePath = join(STATE_DIR, "members.json");
const newMember = (name: string, role: Member["role"]): Member => ({
  id: name,
  name,
  role,
  grants: [],
  work: structuredClone(cfg.defaultWork),
});
const store: Store = existsSync(storePath)
  ? JSON.parse(readFileSync(storePath, "utf8"))
  : { members: {}, accounts: {}, invites: {} };
const saveStore = () => writeFileSync(storePath, JSON.stringify(store, null, 2));
if (!existsSync(storePath)) {
  for (const acc of cfg.admins ?? []) {
    const name = acc.split(":").slice(1).join(":").replace(/\s+/g, "_") || acc;
    store.members[name] ??= newMember(name, "admin");
    store.accounts[acc] = name;
  }
  if (cfg.bootstrapCode) store.invites[cfg.bootstrapCode] = { bootstrap: true };
  saveStore();
  console.log(`[boot] seeded ${storePath} from config`);
}

// ---------- Codi HTTP client (bot = just another client) ----------
const iso = () => new Date().toISOString();

/** Bearer for an env: static token > cached > one-time pairing URL exchange (POST /oauth/token, no DPoP => plain Bearer). */
async function bearer(env: Env): Promise<string> {
  if (env.token) return env.token;
  if (state.bearers[env.id]) return state.bearers[env.id]!;
  if (!env.pairingUrl) throw new Error(`${env.label}: no token/pairingUrl in config`);
  const u = new URL(env.pairingUrl);
  // same parse as packages/shared/src/remote.ts getPairingTokenFromUrl: hash param first, then query
  const credential =
    new URLSearchParams(u.hash.replace(/^#/, "")).get("token") ?? u.searchParams.get("token");
  if (!credential) throw new Error(`${env.label}: pairingUrl has no token`);
  const res = await fetch(new URL("/oauth/token", env.url), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: credential,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: "orchestration:read orchestration:operate",
      client_label: "Codi WeChat bot (prototype)",
      client_device_type: "bot",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok)
    throw new Error(
      `${env.label}: token exchange ${res.status} ${await res.text()} (pairing tokens are one-time; mint a new one)`,
    );
  const j = (await res.json()) as { access_token: string; token_type: string };
  state.bearers[env.id] = j.access_token;
  save();
  console.log(`[codi] ${env.id}: exchanged pairing token for ${j.token_type} bearer`);
  return j.access_token;
}

async function codi(env: Env, path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(new URL(path, env.url), {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${await bearer(env)}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) {
    delete state.bearers[env.id];
    save();
    throw new Error(
      `${env.label}: bearer rejected (cleared cache; needs a fresh pairingUrl/token)`,
    );
  }
  if (!res.ok)
    throw new Error(`${env.label} ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<any>;
}
const dispatch = (env: Env, body: object) =>
  codi(env, "/api/orchestration/dispatch", { method: "POST", body });

type EnvView = {
  env: Env;
  online: boolean;
  error?: string;
  projects: { id: string; title: string; workspaceRoot: string; access?: Access }[];
};
async function envView(env: Env): Promise<EnvView> {
  try {
    const d = await fetch(new URL("/.well-known/t3/environment", env.url), {
      signal: AbortSignal.timeout(4000),
    });
    if (!d.ok) throw new Error(`descriptor ${d.status}`);
    const shell = await codi(env, "/api/orchestration/shell");
    return {
      env,
      online: true,
      projects: shell.projects.map((p: any) => ({
        id: p.id,
        title: p.title,
        workspaceRoot: p.workspaceRoot,
      })),
    };
  } catch (e: any) {
    return { env, online: false, error: String(e?.message ?? e), projects: [] };
  }
}
/** max of matching grants; undefined = no access. */
const accessOf = (m: Member, envId: string, projectId: string): Access | undefined => {
  let a: Access | undefined;
  for (const g of m.grants)
    if (g.environmentId === envId && (g.projectId === "*" || g.projectId === projectId)) {
      if (g.access === "write") return "write";
      a = "read";
    }
  return a;
};
/** Filter BEFORE the model: only envs/projects the member holds a grant on, annotated with access. */
const viewsFor = async (m: Member) => {
  const envs = cfg.environments.filter((e) => m.grants.some((g) => g.environmentId === e.id));
  return (await Promise.all(envs.map(envView))).map((v) => ({
    ...v,
    projects: v.projects
      .map((p) => ({ ...p, access: accessOf(m, v.env.id, p.id) }))
      .filter((p) => p.access),
  }));
};

// ---------- router (assistant model via CLI, user's own subscription) ----------
function runAssistant(prompt: string): Promise<string> {
  const [cmd, ...rest] = cfg.assistant.command;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd!, rest, { cwd: tmpdir() });
    let out = "",
      err = "";
    const t = setTimeout(() => {
      p.kill();
      reject(new Error("assistant timeout 180s"));
    }, 180_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`assistant exit ${code}: ${err.slice(0, 300)}`));
      try {
        const j = JSON.parse(out);
        if (j.is_error) throw new Error(String(j.result));
        resolve(String(j.result ?? ""));
      } catch {
        resolve(out);
      }
    });
    p.stdin.end(prompt);
  });
}
const extractJson = (s: string) => {
  const m = s.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : undefined;
  } catch {
    return undefined;
  }
};

// ---------- proposals / tasks (in memory) ----------
type Proposal = {
  id: number;
  /** member id (permission owner) */
  owner: string;
  /** account to reply to */
  sender: string;
  envId: string;
  projectId: string;
  projectTitle: string;
  root: string;
  sel: ModelSel;
  scope: Scope;
  title: string;
  plan: string[];
  prompt: string;
  /** shown in the proposal, e.g. read-only downgrade */
  note?: string;
  /** wecom group chatid the proposal came from; results go back there */
  chat?: string;
};
type Scope = "investigate" | "fix" | "full";
type Task = {
  id: number;
  owner: string;
  sender: string;
  envId: string;
  projectId: string;
  threadId: string;
  title: string;
  status: "running" | "done" | "error" | "stopped";
  chat?: string;
};
const proposals = new Map<number, Proposal>();
const tasks = new Map<number, Task>();
let nextId = 1;

const SCOPE_LABEL: Record<Scope, string> = {
  investigate: "调查（只读）",
  fix: "调查 → 修复 → 测试",
  full: "调查 → 修复 → 测试 → PR",
};
const SCOPE_RULES: Record<Scope, string> = {
  investigate: "只做调查：不要修改任何文件，不要提交，不要开 PR。输出证据与结论。",
  fix: "先复现/确认问题；确认存在后在独立 git worktree 中修复并运行相关测试；不要开 PR，汇报改动。",
  full: "先调查；如果没有真实问题，立即停止并汇报证据。否则开启/关联 issue，在独立 git worktree 中修复、运行测试，然后开 PR，汇报 PR 链接。",
};
const EFFORT_ZH: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};
const effortOf = (s: ModelSel) =>
  String(s.options?.find((o) => o.id === "effort")?.value ?? "默认");
const fmtProposal = (p: Proposal, envLabel: string) =>
  `#${p.id} ${p.title}\n机器：${envLabel}\n项目：${p.projectTitle} (${p.root})\n执行：${p.sel.instanceId} / ${p.sel.model} / ${EFFORT_ZH[effortOf(p.sel)] ?? effortOf(p.sel)}\n范围：${SCOPE_LABEL[p.scope]}\n` +
  (p.plan.length ? `计划：${p.plan.join("；")}\n` : "") +
  (p.note ? `注意：${p.note}\n` : "") +
  `回复「确认 ${p.id}」开始，「取消 ${p.id}」放弃，或直接说要改什么。`;

const NO_ACCESS = "你目前没有任何项目的访问权限，请联系管理员授权。";

/** Program-side validation of the router's proposal against the member's grants. Never trusts model for ids/scope. */
function validate(
  r: any,
  m: Member,
  views: Awaited<ReturnType<typeof viewsFor>>,
): Proposal | string {
  const labels = views.map((v) => v.env.label).join("、") || "（无）";
  const envId = r.environmentId ?? m.work.environmentId;
  if (!envId) return `要在哪台机器上做？可选：${labels}`;
  const v = views.find((x) => x.env.id === envId || x.env.label === envId);
  if (!v) return `没有叫「${envId}」的机器，或你没有权限。可选：${labels}`;
  const known = v.env;
  if (!v.online)
    return `「${known.label}」当前离线（${v.error?.slice(0, 80)}），不会自动换机器。要换成别的机器请直接说。`;
  const cands = v.projects; // already grant-filtered
  const proj =
    cands.find((p) => p.id === r.projectId) ??
    cands.find((p) => p.title === r.projectId || p.title === r.projectTitle);
  if (!proj)
    return `「${known.label}」上没找到你有权限的项目「${r.projectId ?? ""}」。可选：${cands.map((p) => p.title).join("、") || "（无）"}`;
  const base = m.work.modelSelection;
  let sel: ModelSel = structuredClone(base);
  if (!m.work.lockModel && (r.provider || r.model || r.effort)) {
    sel = {
      instanceId: r.provider ?? base.instanceId,
      model: r.model ?? base.model,
      options: base.options ? [...base.options] : [],
    };
    if (r.effort)
      sel.options = [
        ...(sel.options ?? []).filter((o) => o.id !== "effort"),
        { id: "effort", value: String(r.effort) },
      ];
  }
  let scope: Scope = ["investigate", "fix", "full"].includes(r.scope) ? r.scope : "full";
  let note: string | undefined;
  if (proj.access === "read" && scope !== "investigate") {
    scope = "investigate";
    note = `你对 ${proj.title} 只有只读权限，已改为只调查`;
  }
  return {
    id: nextId++,
    owner: m.id,
    sender: "",
    envId: known.id,
    projectId: proj.id,
    projectTitle: proj.title,
    root: proj.workspaceRoot,
    sel,
    scope,
    note,
    title: String(r.title ?? "任务").slice(0, 60),
    plan: Array.isArray(r.plan) ? r.plan.map(String) : [],
    prompt: String(r.prompt ?? ""),
    chat: chatCtx.getStore()?.chat,
  };
}

async function route(sender: string, m: Member, text: string): Promise<string> {
  const views = await viewsFor(m);
  const nCands = views.reduce((n, v) => n + v.projects.length, 0);
  console.log(
    `[router] ${m.id}: candidates=${nCands} ${JSON.stringify(views.map((v) => ({ env: v.env.id, projects: v.projects.map((p) => `${p.title}:${p.access}`) })))}`,
  );
  const mine = [...proposals.values()].filter((p) => p.owner === m.id);
  const defEnv = views.some((v) => v.env.id === m.work.environmentId) ? m.work.environmentId : null;
  const prompt = `你是 Codi 微信机器人的路由助手。只输出一个 JSON 对象，不要任何其它文字，不要代码围栏。
用户消息（可能是转发的工作消息）：
<<<
${text}
>>>
用户配置：${JSON.stringify({ name: m.name, defaultEnvironment: defEnv, defaultWork: m.work.modelSelection, modelLocked: !!m.work.lockModel })}
该用户有权限的机器与项目（真实数据，不要编造；offline 的机器不能用；access=read 的项目只能调查，不能修改）：
${JSON.stringify(views.map((v) => ({ environmentId: v.env.id, label: v.env.label, online: v.online, projects: v.projects.map((p) => ({ projectId: p.id, title: p.title, path: p.workspaceRoot, access: p.access })) })))}
${nCands ? "" : "该用户没有任何项目权限：工程类请求也照常输出 proposal（程序会拒绝），不要 clarify。\n"}该用户当前待确认的方案：${JSON.stringify(mine.map((p) => ({ id: p.id, environmentId: p.envId, projectId: p.projectId, scope: p.scope, title: p.title, provider: p.sel.instanceId, model: p.sel.model, effort: effortOf(p.sel), prompt: p.prompt })))}
规则：
- 简单提问/闲聊/小事：直接回答 {"kind":"answer","answer":"..."}（中文，简短）。
- 需要在某台机器的某个项目里动手（排查/修 bug/开 PR 等）：{"kind":"proposal","environmentId":"...","projectId":"...","provider":null,"model":null,"effort":null,"scope":"investigate|fix|full","title":"短标题","plan":["步骤"],"prompt":"给 agent 的完整任务描述（包含原始消息里的全部关键信息）","replaces":null}
  - provider/model/effort 默认全部填 null（使用用户默认）；只有用户消息明确指定时才填。
  - environmentId 优先用消息里明确提到的机器，否则用 defaultEnvironment，仍不确定就 clarify。projectId 只能来自上面的列表。
  - 用户说"只调查/不要改"→ scope=investigate；"修复但不提 PR"→ fix；否则 full。access=read 的项目一律 scope=investigate。
  - 如果用户是在修改某个待确认方案（换机器、改范围…），输出修改后的完整 proposal，并把 replaces 设为被修改方案的 id。
- 信息不足或不确定：{"kind":"clarify","question":"..."}
- 用户点名的机器若 offline：输出 proposal 仍使用该机器，由程序告知离线。`;
  const raw = await runAssistant(prompt);
  const r = extractJson(raw);
  if (!r || !r.kind) return raw.trim().slice(0, 1500) || "（助手没有返回内容）"; // plain text => treat as answer
  if (r.kind === "answer") return String(r.answer);
  if (!nCands && !m.grants.length && (r.kind === "clarify" || r.kind === "proposal"))
    return NO_ACCESS; // deterministic, whatever the model said
  if (r.kind === "clarify") return String(r.question);
  if (r.kind === "proposal") {
    const p = validate(r, m, views);
    if (typeof p === "string") return p;
    p.sender = sender;
    if (r.replaces != null && proposals.get(Number(r.replaces))?.owner === m.id)
      proposals.delete(Number(r.replaces));
    proposals.set(p.id, p);
    return fmtProposal(p, cfg.environments.find((e) => e.id === p.envId)!.label);
  }
  return `助手返回了未知结果：${raw.slice(0, 200)}`;
}

// ---------- confirm / progress / stop ----------
/** Members see only their own proposals/tasks; `all` (admin, tasks only) sees everyone's. */
const pick = <T extends { id: number; owner: string }>(
  map: Map<number, T>,
  m: Member,
  idArg: string,
  all = false,
): T | string => {
  const own = [...map.values()].filter((x) => all || x.owner === m.id);
  if (idArg) return own.find((x) => x.id === Number(idArg)) ?? `没有找到 #${idArg}`;
  return own.length === 1
    ? own[0]!
    : own.length === 0
      ? "没有可操作的项目"
      : `有多个（${own.map((x) => `#${x.id}${all ? `(${x.owner})` : ""}`).join("、")}），请带上编号`;
};

/** Re-checks grants at confirm time (never trust the proposal's age). read => plan mode + approval-required, enforced by runtime. */
async function start(p: Proposal, m: Member): Promise<string> {
  const access = accessOf(m, p.envId, p.projectId);
  if (!access) {
    proposals.delete(p.id);
    return `你已没有「${p.projectTitle}」的权限，方案 #${p.id} 已作废。`;
  }
  const ro = access === "read";
  const scope: Scope = ro ? "investigate" : p.scope;
  const runtimeMode = ro ? "approval-required" : "full-access";
  const interactionMode = ro ? "plan" : "default";
  const env = cfg.environments.find((e) => e.id === p.envId)!;
  const threadId = randomUUID();
  const now = iso();
  await dispatch(env, {
    type: "thread.create",
    commandId: randomUUID(),
    threadId,
    projectId: p.projectId,
    title: p.title,
    modelSelection: p.sel,
    runtimeMode,
    interactionMode,
    branch: null,
    worktreePath: null,
    createdAt: now,
  });
  await dispatch(env, {
    type: "thread.turn.start",
    commandId: randomUUID(),
    threadId,
    message: {
      messageId: randomUUID(),
      role: "user",
      text: `${SCOPE_RULES[scope]}\n\n任务：\n${p.prompt}`,
      attachments: [],
    },
    modelSelection: p.sel,
    runtimeMode,
    interactionMode,
    createdAt: iso(),
  });
  proposals.delete(p.id);
  tasks.set(p.id, {
    id: p.id,
    owner: p.owner,
    sender: p.sender,
    envId: p.envId,
    projectId: p.projectId,
    threadId,
    title: p.title,
    status: "running",
    chat: p.chat,
  });
  return (
    `已开始 #${p.id} → ${p.title}` +
    (ro && p.scope !== "investigate" ? "（只读权限，已改为只调查）" : "")
  );
}

async function threadInfo(t: Task) {
  const env = cfg.environments.find((e) => e.id === t.envId)!;
  const d = await codi(env, `/api/orchestration/threads/${t.threadId}?turnLimit=1`);
  const th = d.thread;
  const lastAssistant = [...th.messages]
    .reverse()
    .find((m: any) => m.role === "assistant" && m.text?.trim());
  return {
    th,
    text: lastAssistant?.text as string | undefined,
    turn: th.latestTurn as { state: string } | null,
  };
}

async function progress(t: Task): Promise<string> {
  try {
    const { th, text, turn } = await threadInfo(t);
    return (
      `#${t.id} ${th.title}\n状态：${turn?.state ?? "等待开始"}（会话 ${th.session?.status ?? "-"}）` +
      (text ? `\n最新回复：${text.slice(-500)}` : "")
    );
  } catch (e: any) {
    return `#${t.id} 查询失败：${e.message}`;
  }
}

// ponytail: polling, use WS subscription for real
async function pollTasks() {
  for (const t of tasks.values()) {
    if (t.status !== "running") continue;
    try {
      const { th, text, turn } = await threadInfo(t);
      if (!turn || turn.state === "running") continue;
      t.status =
        turn.state === "completed" ? "done" : turn.state === "interrupted" ? "stopped" : "error";
      const body =
        turn.state === "error"
          ? `出错：${th.session?.lastError ?? "未知"}`
          : (text ?? "（无回复内容）");
      const o = store.members[t.owner];
      if (o && (o.role === "admin" || accessOf(o, t.envId, t.projectId)))
        await out(
          t.sender,
          `#${t.id} ${th.title} — ${turn.state}\n${body.length > 1500 ? body.slice(0, 1500) + "…" : body}`,
          t.chat,
        );
      dump();
    } catch (e: any) {
      console.log(`[poll] #${t.id} ${e.message}`);
    }
  }
}

// ---------- message handling ----------
/** Per-inbound-message context (wecom): req_id to reply on + group chatid. Read by validate() and out(). */
const chatCtx = new AsyncLocalStorage<{ reqId?: string; chat?: string; used?: boolean }>();
let out: (sender: string, text: string, chat?: string) => Promise<void> = async () => {};

const HELP =
  "命令：确认 [编号] / 取消 [编号] / 进度 [编号] / 停止 编号 / 帮助\n其它消息：简单问题我直接答；工作类消息我先给方案，确认后才会开工。\n只读项目只能调查；停止任务需要写权限。";
const ADMIN_HELP =
  "\n管理员命令（私聊）：\n成员 / 项目\n新成员 名字 / 邀请 成员（一次性邀请码，24h）\n授权 成员 环境/项目 读|写（项目可用 * ）/ 撤权 成员 环境/项目\n解绑 账号 / 删除成员 成员\n设为管理员 成员 / 取消管理员 成员";

const envLabel = (id: string) => cfg.environments.find((e) => e.id === id)?.label ?? id;
const accountsOf = (m: Member) =>
  Object.entries(store.accounts)
    .filter(([, id]) => id === m.id)
    .map(([a]) => a);
const memberCard = (m: Member) =>
  `${m.name} [${m.role === "admin" ? "管理员" : "成员"}]\n  账号：${accountsOf(m).join("、") || "（无）"}\n  授权：` +
  (m.grants.length
    ? m.grants
        .map(
          (g) =>
            `\n    ${envLabel(g.environmentId)} / ${g.projectId === "*" ? "* [全部项目]" : (g.title ?? g.projectId)} ${g.access === "write" ? "写" : "读"}`,
        )
        .join("")
    : "（无，看不到任何项目）");

// ponytail: codes are 32-bit random, no attempt rate limit; add one if exposed publicly
const newInvite = (memberId: string) => {
  const code = randomBytes(4).toString("hex").toUpperCase();
  store.invites[code] = { memberId, exp: Date.now() + 24 * 3600_000 };
  return code;
};
/** would any admin with at least one account remain after skipping a member / an account? */
const hasAdmin = (skipMember?: string, skipAccount?: string) =>
  Object.values(store.members).some(
    (x) =>
      x.role === "admin" && x.id !== skipMember && accountsOf(x).some((a) => a !== skipAccount),
  );

function bind(sender: string, code: string): string {
  const cur = store.accounts[sender];
  if (cur) return `此账号已绑定为「${cur}」。换绑请让管理员先「解绑 ${sender}」。`;
  const inv = store.invites[code] ?? store.invites[code.toUpperCase()];
  const key = store.invites[code] ? code : code.toUpperCase();
  if (!inv || (inv.exp && inv.exp < Date.now())) {
    if (inv) delete store.invites[key];
    saveStore();
    return "邀请码无效或已过期。";
  }
  let mid = inv.memberId;
  if (inv.bootstrap) {
    const base = sender.split(":").slice(1).join(":").replace(/\s+/g, "_") || "admin";
    let name = base;
    for (let i = 2; store.members[name]; i++) name = `${base}${i}`;
    store.members[name] = newMember(name, "admin");
    mid = name;
  }
  const m = mid && store.members[mid];
  if (!m) return "邀请码无效（成员已被删除）。";
  delete store.invites[key]; // single use
  store.accounts[sender] = m.id;
  saveStore();
  return (
    `已绑定为「${m.name}」（${m.role === "admin" ? "管理员" : "成员"}）。` +
    (m.grants.length ? "" : "\n你目前没有任何项目权限，请联系管理员授权。") +
    "\n发「帮助」查看用法。"
  );
}

const envByRef = (ref: string) =>
  cfg.environments.find((e) => e.id === ref || e.label.toLowerCase() === ref.toLowerCase());

async function adminCmd(me: Member, verb: string, arg: string): Promise<string> {
  const target = () => store.members[arg.trim()];
  const noMember = `没有成员「${arg}」。发「成员」查看。`;
  switch (verb) {
    case "成员":
      return Object.values(store.members).map(memberCard).join("\n") || "（没有成员）";
    case "项目": {
      const vs = await Promise.all(cfg.environments.map(envView));
      return vs
        .map(
          (v) =>
            `${v.env.label} (id: ${v.env.id}) ${v.online ? "在线" : "离线"}` +
            v.projects.map((p) => `\n  ${p.id}  ${p.title}  ${p.workspaceRoot}`).join(""),
        )
        .join("\n");
    }
    case "新成员": {
      const name = arg.trim();
      if (!name || /\s/.test(name)) return "用法：新成员 <名字>（不含空格）";
      if (store.members[name]) return `成员「${name}」已存在。要关联新账号请用「邀请 ${name}」。`;
      store.members[name] = newMember(name, "member");
      const code = newInvite(name);
      saveStore();
      return `已创建成员。\n${memberCard(store.members[name])}\n邀请码（24 小时内、仅可用一次）：${code}\n让对方私聊我发送「绑定 ${code}」。`;
    }
    case "邀请": {
      const m = target();
      if (!m) return noMember;
      const code = newInvite(m.id);
      saveStore();
      return `「${m.name}」的新邀请码（24 小时内、仅可用一次）：${code}\n在要关联的账号上私聊我发送「绑定 ${code}」。`;
    }
    case "授权":
    case "撤权": {
      const toks = arg.trim().split(/\s+/);
      const who = toks.shift() ?? "";
      const m = store.members[who];
      if (!m) return noMember.replace(arg, who);
      const grant = verb === "授权";
      const accTok = grant ? toks.pop() : undefined;
      const access: Access | undefined = { 读: "read", read: "read", 写: "write", write: "write" }[
        accTok ?? ""
      ] as Access | undefined;
      const spec = toks.join(" ");
      const slash = spec.indexOf("/");
      if (slash < 0 || (grant && !access))
        return grant
          ? "用法：授权 <成员> <环境>/<项目|*> 读|写"
          : "用法：撤权 <成员> <环境>/<项目|*>";
      const env = envByRef(spec.slice(0, slash).trim());
      const projRef = spec.slice(slash + 1).trim();
      if (!env) return `没有这台机器「${spec.slice(0, slash)}」。发「项目」查看。`;
      if (!grant) {
        const lc = projRef.toLowerCase();
        const i = m.grants.findIndex(
          (g) =>
            g.environmentId === env.id &&
            (g.projectId === projRef || g.title?.toLowerCase() === lc),
        );
        if (i < 0) return `${m.name} 没有 ${env.label}/${projRef} 这条授权。\n${memberCard(m)}`;
        const [gone] = m.grants.splice(i, 1);
        saveStore();
        const still =
          projRef !== "*" &&
          m.grants.some((g) => g.environmentId === env.id && g.projectId === "*");
        return (
          `已撤销 ${m.name} 的 ${env.label}/${gone!.title ?? gone!.projectId}。` +
          (still ? "\n注意：他仍持有该机器的 * 全部项目授权。" : "") +
          `\n${memberCard(m)}`
        );
      }
      let pid = "*";
      let title: string | undefined;
      if (projRef !== "*") {
        const v = await envView(env);
        if (!v.online) return `「${env.label}」离线，无法解析项目（可用 * 授权整台机器）。`;
        const lc = projRef.toLowerCase();
        const hits = v.projects.filter((p) => p.id === projRef);
        const byTitle = hits.length ? hits : v.projects.filter((p) => p.title.toLowerCase() === lc);
        if (byTitle.length !== 1)
          return byTitle.length
            ? `「${projRef}」有多个同名项目，请用 id：${byTitle.map((p) => p.id).join("、")}`
            : `${env.label} 上没有项目「${projRef}」。发「项目」查看。`;
        pid = byTitle[0]!.id;
        title = byTitle[0]!.title;
      }
      const ex = m.grants.find((g) => g.environmentId === env.id && g.projectId === pid);
      if (ex) {
        ex.access = access!;
        ex.title = title;
      } else m.grants.push({ environmentId: env.id, projectId: pid, title, access: access! });
      saveStore();
      return `已授权 ${m.name}：${env.label}/${title ?? "* [全部项目]"} ${access === "write" ? "写" : "读"}\n${memberCard(m)}`;
    }
    case "解绑": {
      const acc = arg.trim();
      const mid = store.accounts[acc];
      if (!mid) return `账号「${acc}」没有绑定。发「成员」查看。`;
      const m = store.members[mid]!;
      if (m.role === "admin" && !hasAdmin(undefined, acc))
        return "不能解绑最后一位管理员的最后一个账号。";
      delete store.accounts[acc];
      saveStore();
      return `已解绑 ${acc}（它不再能使用 Codi）。\n${memberCard(m)}`;
    }
    case "删除成员": {
      const m = target();
      if (!m) return noMember;
      if (m.role === "admin" && !hasAdmin(m.id)) return "不能删除最后一位管理员。";
      const accs = accountsOf(m);
      for (const a of accs) delete store.accounts[a];
      for (const [c, i] of Object.entries(store.invites))
        if (i.memberId === m.id) delete store.invites[c];
      for (const p of [...proposals.values()]) if (p.owner === m.id) proposals.delete(p.id);
      delete store.members[m.id];
      saveStore();
      const running = [...tasks.values()].filter((t) => t.owner === m.id && t.status === "running");
      return (
        `已删除成员 ${m.name}（解绑 ${accs.join("、") || "无账号"}）。` +
        (running.length
          ? `\n他有 ${running.length} 个任务仍在运行（${running.map((t) => "#" + t.id).join("、")}），不会被终止，完成后也不再通知他；可用「停止 编号」。`
          : "")
      );
    }
    case "设为管理员":
    case "取消管理员": {
      const m = target();
      if (!m) return noMember;
      const up = verb === "设为管理员";
      if (!up && m.role === "admin" && !hasAdmin(m.id)) return "不能取消最后一位管理员。";
      m.role = up ? "admin" : "member";
      saveStore();
      return `${m.name} 现在是${up ? "管理员" : "普通成员"}。\n${memberCard(m)}`;
    }
  }
  return "未知管理命令";
}

async function handle(sender: string, text: string) {
  text = text.trim();
  const bm = text.match(/^绑定\s*(\S*)$/);
  if (bm) return out(sender, bind(sender, bm[1]!));
  const m = store.members[store.accounts[sender] ?? ""];
  if (!m) return out(sender, "你还没有绑定。请发送「绑定 <邀请码>」。");
  const isAdmin = m.role === "admin";
  if (/^(帮助|help)$/i.test(text)) return out(sender, HELP + (isAdmin ? ADMIN_HELP : ""));
  // admin commands: fixed, no model call. Checked before 确认/取消 so 「取消管理员」 is not 「取消」.
  const am =
    text.match(/^(成员|项目)$/) ??
    text.match(/^(新成员|邀请|授权|撤权|解绑|删除成员|设为管理员|取消管理员)\s+([\s\S]+)$/);
  if (am) {
    if (!isAdmin) return out(sender, "需要管理员权限");
    if ((am[1] === "新成员" || am[1] === "邀请") && chatCtx.getStore()?.chat)
      return out(sender, "请私聊我获取邀请码");
    try {
      return out(sender, await adminCmd(m, am[1]!, am[2] ?? ""));
    } catch (e: any) {
      return out(sender, `管理命令失败：${e.message}`);
    }
  }
  const cmd = text.match(/^(确认|取消|进度|停止)\s*#?\s*(\S*)$/);
  if (cmd) {
    const [, verb, idArg] = cmd as unknown as [string, string, string];
    if (verb === "确认" || verb === "取消") {
      const p = pick(proposals, m, idArg);
      if (typeof p === "string")
        return out(sender, p === "没有可操作的项目" ? "没有待确认的方案。" : p);
      if (verb === "取消") {
        proposals.delete(p.id);
        return out(sender, `已取消 #${p.id}`);
      }
      try {
        return out(sender, await start(p, m));
      } catch (e: any) {
        return out(sender, `启动失败（方案 #${p.id} 仍保留，可重试确认）：${e.message}`);
      }
    }
    const t = pick(tasks, m, idArg, isAdmin);
    if (typeof t === "string") return out(sender, t === "没有可操作的项目" ? "没有任务。" : t);
    const acc = accessOf(m, t.envId, t.projectId);
    if (verb === "进度") {
      if (!isAdmin && !acc) return out(sender, "你已没有该项目的访问权限。");
      return out(sender, await progress(t));
    }
    if (verb === "停止") {
      if (!isAdmin && acc !== "write") return out(sender, "停止任务需要该项目的写权限。");
      const env = cfg.environments.find((e) => e.id === t.envId)!;
      try {
        await dispatch(env, {
          type: "thread.turn.interrupt",
          commandId: randomUUID(),
          threadId: t.threadId,
          createdAt: iso(),
        });
        return out(sender, `已请求停止 #${t.id}`);
      } catch (e: any) {
        return out(sender, `停止失败：${e.message}`);
      }
    }
  }
  try {
    await out(sender, await route(sender, m, text));
  } catch (e: any) {
    await out(sender, `处理失败：${e.message}`);
  }
}

function dump() {
  console.log(
    "[state] " +
      JSON.stringify({
        members: Object.values(store.members).map(
          (m) =>
            `${m.id}[${m.role}] accts=${accountsOf(m).join("|")} grants=${m.grants.map((g) => `${g.environmentId}/${g.title ?? g.projectId}:${g.access}`).join("|")}`,
        ),
        invites: Object.keys(store.invites).length,
        pending: [...proposals.values()].map(
          (p) => `#${p.id}(${p.owner},${p.envId}/${p.projectTitle},${p.scope})`,
        ),
        tasks: [...tasks.values()].map(
          (t) => `#${t.id}(${t.owner},${t.status},${t.envId},${t.threadId.slice(0, 8)})`,
        ),
      }),
  );
}
const handleAndDump = async (s: string, t: string) => {
  await handle(s, t);
  dump();
};

// ---------- transports ----------
setInterval(() => void pollTasks(), 10_000);

if (transport === "cli") {
  out = async (s, t) => console.log(`[bot → ${s}] ${t}`);
  console.log(
    "cli: type `@root <text>` (sticky; account cli:root). Bootstrap: `@root 绑定 <bootstrapCode>`",
  );
  let cur = "root";
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const m = line.match(/^@(\S+)\s+([\s\S]*)$/);
    if (m) cur = m[1]!;
    const text = m ? m[2]! : line;
    console.log(`[${cur} → bot] ${text}`);
    await handleAndDump(`cli:${cur}`, text);
  }
  while ([...tasks.values()].some((t) => t.status === "running"))
    await new Promise((r) => setTimeout(r, 1000)); // let running tasks report
  process.exit(0);
} else if (transport === "wecom") {
  // ---- WeCom 智能机器人 long connection. One bot, many members; sender key = `wecom:<userid>`. ----
  const wc = cfg.wecom;
  if (!wc?.botId || !wc.secret) {
    console.log("config.wecom.{botId,secret} missing");
    process.exit(1);
  }
  const client = wecom.connect(wc, (m) => {
    // Group callbacks only arrive when the bot is @-mentioned; strip leading "@name".
    const text = (m.chatid ? m.text.replace(/^(\s*@\S+)+\s*/, "") : m.text).trim();
    if (!text) return;
    const sender = `wecom:${m.userid}`;
    console.log(`[${sender}${m.chatid ? ` @${m.chatid}` : ""} → bot] ${text}`);
    void chatCtx.run({ reqId: m.reqId, chat: m.chatid }, () => handleAndDump(sender, text));
  });
  out = async (sender, text, chat) => {
    const ctx = chatCtx.getStore();
    const to = chat ?? ctx?.chat ?? sender.slice("wecom:".length);
    console.log(`[bot → ${sender}${chat || ctx?.chat ? ` @${to}` : ""}] ${text}`);
    if (ctx?.reqId && !ctx.used) {
      ctx.used = true; // req_id replies are one-shot here; later messages go proactive
      try {
        return await client.respond(ctx.reqId, text);
      } catch (e: any) {
        console.log(`[wecom] respond failed (${e.message}); falling back to proactive send`);
      }
    }
    try {
      await client.send(to, text);
    } catch (e: any) {
      console.log(`[send] failed: ${e.message}`);
    }
  };
  await new Promise(() => {}); // run forever
} else {
  // ---- real WeChat (iLink). One QR login = one bot account bound to the scanning user; N users = N logins. ----
  const accPath = join(STATE_DIR, "ilink.json");
  const accounts: Record<string, ilink.Account> = existsSync(accPath)
    ? JSON.parse(readFileSync(accPath, "utf8"))
    : {};
  const ask = (q: string) =>
    new Promise<string>((r) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(q, (a) => {
        rl.close();
        r(a.trim());
      });
    });
  if (login) {
    const { id, acc } = await ilink.qrLogin(
      Object.values(accounts).map((a) => a.token),
      async (url) => {
        try {
          const q: any = await import(/* @vite-ignore */ "qrcode-terminal");
          q.default.generate(url, { small: true });
        } catch {
          /* not installed */
        }
        console.log(`用手机微信扫码，或打开：${url}`);
      },
      ask,
    );
    accounts[id] = acc;
    writeFileSync(accPath, JSON.stringify(accounts, null, 2), { mode: 0o600 });
    console.log(
      `[login] account ${id} bound to wechat user ${acc.userId}. Accounts now: ${Object.keys(accounts).length}`,
    );
  }
  if (!Object.keys(accounts).length) {
    console.log("no iLink accounts; run with --login");
    process.exit(1);
  }

  out = async (sender, text) => {
    const r = state.ctx[sender]; // key = `weixin:<from_user_id>`
    const acc = r && accounts[r.account];
    if (!acc) return console.log(`[bot → ${sender}] (no route) ${text}`);
    console.log(`[bot → ${sender}] ${text}`);
    try {
      await ilink.sendText(acc, sender.slice("weixin:".length), text, r.contextToken);
    } catch (e: any) {
      console.log(`[send] failed: ${e.message}`);
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const bufPath = (id: string) => join(STATE_DIR, `buf-${id.replace(/[^\w.-]/g, "_")}.txt`);
  const loop = async (id: string, acc: ilink.Account) => {
    let buf = existsSync(bufPath(id)) ? readFileSync(bufPath(id), "utf8") : "";
    console.log(`[weixin] polling account=${id} user=${acc.userId}`);
    for (;;) {
      try {
        const r = await ilink.getUpdates(acc, buf);
        if ((r.ret && r.ret !== 0) || (r.errcode && r.errcode !== 0)) {
          console.log(
            `[weixin] ${id} ret=${r.ret} errcode=${r.errcode} ${r.errmsg ?? ""}${r.errcode === -14 || r.ret === -14 ? " (session expired; re-run --login)" : ""}`,
          );
          await sleep(r.errcode === -14 || r.ret === -14 ? 60_000 : 3000);
          continue;
        }
        if (r.get_updates_buf) {
          buf = r.get_updates_buf;
          writeFileSync(bufPath(id), buf);
        }
        for (const m of r.msgs ?? []) {
          const text = ilink.textOf(m);
          if (!text || !m.from_user_id) continue;
          const sender = `weixin:${m.from_user_id}`;
          state.ctx[sender] = { account: id, contextToken: m.context_token };
          save();
          console.log(`[${sender} → bot] ${text}`);
          await handleAndDump(sender, text);
        }
      } catch (e: any) {
        console.log(`[weixin] ${id} error: ${e.message}`);
        await sleep(3000);
      }
    }
  };
  await Promise.all(Object.entries(accounts).map(([id, acc]) => loop(id, acc)));
}
