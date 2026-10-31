// PROTOTYPE, throwaway ("wipe me"). WeChat ClawBot <-> Codi bridge.
// Run: bun prototype/wechat-bot/bot.ts [--transport=cli|weixin|wecom] [--login] [--config=path]
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as ilink from "./ilink.ts";
import * as wecom from "./wecom.ts";

const DIR = import.meta.dir;
const STATE_DIR = join(DIR, ".state");
mkdirSync(STATE_DIR, { recursive: true });
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "bun prototype/wechat-bot/bot.ts [--transport=cli|weixin|wecom] [--login] [--config=path]\nconfig: .state/config.json (falls back to config.example.json)",
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
type Profile = {
  name: string;
  allowedEnvironments: string[];
  allowedProjects?: Record<string, string[]>;
  work: { environmentId?: string; modelSelection: ModelSel; lockModel?: boolean };
};
type Config = {
  assistant: { command: string[] };
  environments: Env[];
  users: Record<string, Profile>;
  invites: Record<string, string>;
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
  bindings: Record<string, string>;
  bearers: Record<string, string>;
  ctx: Record<string, { account: string; contextToken?: string }>;
} = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { bindings: {}, bearers: {}, ctx: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

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
  projects: { id: string; title: string; workspaceRoot: string }[];
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
const viewsFor = (p: Profile) =>
  Promise.all(cfg.environments.filter((e) => p.allowedEnvironments.includes(e.id)).map(envView));

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
  /** wecom group chatid the proposal came from; results go back there */
  chat?: string;
};
type Scope = "investigate" | "fix" | "full";
type Task = {
  id: number;
  sender: string;
  envId: string;
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
  `回复「确认 ${p.id}」开始，「取消 ${p.id}」放弃，或直接说要改什么。`;

/** Program-side validation of the router's proposal. Returns Proposal or a clarify message. Never trusts model for ids. */
function validate(r: any, sender: string, prof: Profile, views: EnvView[]): Proposal | string {
  const envId = r.environmentId ?? prof.work.environmentId;
  if (!envId) return "要在哪台机器上做？请告诉我机器名。";
  const known = cfg.environments.find((e) => e.id === envId || e.label === envId);
  if (!known) return `没有叫「${envId}」的机器。可选：${views.map((v) => v.env.label).join("、")}`;
  if (!prof.allowedEnvironments.includes(known.id))
    return `你没有权限使用「${known.label}」。可选：${views.map((v) => v.env.label).join("、")}`;
  const v = views.find((x) => x.env.id === known.id)!;
  if (!v.online)
    return `「${known.label}」当前离线（${v.error?.slice(0, 80)}），不会自动换机器。要换成别的机器请直接说。`;
  const allowed = prof.allowedProjects?.[known.id];
  const cands = v.projects.filter(
    (p) => !allowed || allowed.includes(p.id) || allowed.includes(p.title),
  );
  const proj =
    cands.find((p) => p.id === r.projectId) ??
    cands.find((p) => p.title === r.projectId || p.title === r.projectTitle);
  if (!proj)
    return `「${known.label}」上没找到项目「${r.projectId ?? ""}」。可选：${cands.map((p) => p.title).join("、") || "（无）"}`;
  const base = prof.work.modelSelection;
  let sel: ModelSel = structuredClone(base);
  if (!prof.work.lockModel && (r.provider || r.model || r.effort)) {
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
  const scope: Scope = ["investigate", "fix", "full"].includes(r.scope) ? r.scope : "full";
  return {
    id: nextId++,
    sender,
    envId: known.id,
    projectId: proj.id,
    projectTitle: proj.title,
    root: proj.workspaceRoot,
    sel,
    scope,
    title: String(r.title ?? "任务").slice(0, 60),
    plan: Array.isArray(r.plan) ? r.plan.map(String) : [],
    prompt: String(r.prompt ?? ""),
    chat: chatCtx.getStore()?.chat,
  };
}

async function route(sender: string, prof: Profile, text: string): Promise<string> {
  const views = await viewsFor(prof);
  const mine = [...proposals.values()].filter((p) => p.sender === sender);
  const prompt = `你是 Codi 微信机器人的路由助手。只输出一个 JSON 对象，不要任何其它文字，不要代码围栏。
用户消息（可能是转发的工作消息）：
<<<
${text}
>>>
用户配置：${JSON.stringify({ name: prof.name, defaultEnvironment: prof.work.environmentId, defaultWork: prof.work.modelSelection, modelLocked: !!prof.work.lockModel })}
可用机器与项目（真实数据，不要编造；offline 的机器不能用）：
${JSON.stringify(views.map((v) => ({ environmentId: v.env.id, label: v.env.label, online: v.online, projects: v.projects.map((p) => ({ projectId: p.id, title: p.title, path: p.workspaceRoot })) })))}
该用户当前待确认的方案：${JSON.stringify(mine.map((p) => ({ id: p.id, environmentId: p.envId, projectId: p.projectId, scope: p.scope, title: p.title, provider: p.sel.instanceId, model: p.sel.model, effort: effortOf(p.sel), prompt: p.prompt })))}
规则：
- 简单提问/闲聊/小事：直接回答 {"kind":"answer","answer":"..."}（中文，简短）。
- 需要在某台机器的某个项目里动手（排查/修 bug/开 PR 等）：{"kind":"proposal","environmentId":"...","projectId":"...","provider":null,"model":null,"effort":null,"scope":"investigate|fix|full","title":"短标题","plan":["步骤"],"prompt":"给 agent 的完整任务描述（包含原始消息里的全部关键信息）","replaces":null}
  - provider/model/effort 默认全部填 null（使用用户默认）；只有用户消息明确指定时才填。
  - environmentId 优先用消息里明确提到的机器，否则用 defaultEnvironment，仍不确定就 clarify。projectId 只能来自上面的列表。
  - 用户说"只调查/不要改"→ scope=investigate；"修复但不提 PR"→ fix；否则 full。
  - 如果用户是在修改某个待确认方案（换机器、改范围…），输出修改后的完整 proposal，并把 replaces 设为被修改方案的 id。
- 信息不足或不确定：{"kind":"clarify","question":"..."}
- 用户点名的机器若 offline：输出 proposal 仍使用该机器，由程序告知离线。`;
  const raw = await runAssistant(prompt);
  const r = extractJson(raw);
  if (!r || !r.kind) return raw.trim().slice(0, 1500) || "（助手没有返回内容）"; // plain text => treat as answer
  if (r.kind === "answer") return String(r.answer);
  if (r.kind === "clarify") return String(r.question);
  if (r.kind === "proposal") {
    const p = validate(r, sender, prof, views);
    if (typeof p === "string") return p;
    if (r.replaces != null && proposals.get(Number(r.replaces))?.sender === sender)
      proposals.delete(Number(r.replaces));
    proposals.set(p.id, p);
    return fmtProposal(p, cfg.environments.find((e) => e.id === p.envId)!.label);
  }
  return `助手返回了未知结果：${raw.slice(0, 200)}`;
}

// ---------- confirm / progress / stop ----------
const pickOwn = <T extends { id: number; sender: string }>(
  m: Map<number, T>,
  sender: string,
  idArg: string,
): T | string => {
  if (idArg) {
    const x = m.get(Number(idArg));
    return x && x.sender === sender ? x : `没有找到 #${idArg}`;
  }
  const own = [...m.values()].filter((x) => x.sender === sender);
  return own.length === 1
    ? own[0]!
    : own.length === 0
      ? "没有可操作的项目"
      : `有多个（${own.map((x) => "#" + x.id).join("、")}），请带上编号`;
};

async function start(p: Proposal): Promise<string> {
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
    runtimeMode: "full-access",
    interactionMode: "default",
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
      text: `${SCOPE_RULES[p.scope]}\n\n任务：\n${p.prompt}`,
      attachments: [],
    },
    modelSelection: p.sel,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: iso(),
  });
  proposals.delete(p.id);
  tasks.set(p.id, {
    id: p.id,
    sender: p.sender,
    envId: p.envId,
    threadId,
    title: p.title,
    status: "running",
    chat: p.chat,
  });
  return `已开始 #${p.id} → ${p.title}`;
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
  "命令：确认 [编号] / 取消 [编号] / 进度 [编号] / 停止 编号 / 绑定 邀请码 / 帮助\n其它消息：简单问题我直接答；工作类消息我先给方案，确认后才会开工。";

async function handle(sender: string, text: string) {
  text = text.trim();
  const cmd = text.match(/^(确认|取消|进度|停止|绑定)\s*#?\s*(\S*)$/);
  const profName = state.bindings[sender];
  const prof = profName ? cfg.users[profName] : undefined;
  if (cmd && cmd[1] === "绑定") {
    const target = cfg.invites[cmd[2]!];
    if (!target || !cfg.users[target]) return out(sender, "邀请码无效。");
    state.bindings[sender] = target;
    save();
    return out(sender, `已绑定为「${cfg.users[target]!.name}」。发「帮助」查看用法。`);
  }
  if (!prof) return out(sender, "你还没有绑定。请发送「绑定 <邀请码>」。");
  if (/^(帮助|help)$/i.test(text)) return out(sender, HELP);
  if (cmd) {
    const [, verb, idArg] = cmd as unknown as [string, string, string];
    if (verb === "确认" || verb === "取消") {
      const p = pickOwn(proposals, sender, idArg!);
      if (typeof p === "string")
        return out(sender, p === "没有可操作的项目" ? "没有待确认的方案。" : p);
      if (verb === "取消") {
        proposals.delete(p.id);
        return out(sender, `已取消 #${p.id}`);
      }
      try {
        return out(sender, await start(p));
      } catch (e: any) {
        return out(sender, `启动失败（方案 #${p.id} 仍保留，可重试确认）：${e.message}`);
      }
    }
    const t = pickOwn(tasks, sender, idArg!);
    if (typeof t === "string") return out(sender, t === "没有可操作的项目" ? "没有任务。" : t);
    if (verb === "进度") return out(sender, await progress(t));
    if (verb === "停止") {
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
    await out(sender, await route(sender, prof, text));
  } catch (e: any) {
    await out(sender, `处理失败：${e.message}`);
  }
}

function dump() {
  console.log(
    "[state] " +
      JSON.stringify({
        users: state.bindings,
        pending: [...proposals.values()].map(
          (p) => `#${p.id}(${p.sender},${p.envId}/${p.projectTitle},${p.scope})`,
        ),
        tasks: [...tasks.values()].map(
          (t) => `#${t.id}(${t.sender},${t.status},${t.envId},${t.threadId.slice(0, 8)})`,
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
  console.log("cli: type `@alice <text>` (sticky). Bind first: `@alice 绑定 TEST1`");
  let cur = "alice";
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const m = line.match(/^@(\S+)\s+([\s\S]*)$/);
    if (m) cur = m[1]!;
    const text = m ? m[2]! : line;
    console.log(`[${cur} → bot] ${text}`);
    await handleAndDump(cur, text);
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
    const r = state.ctx[sender];
    const acc = r && accounts[r.account];
    if (!acc) return console.log(`[bot → ${sender}] (no route) ${text}`);
    console.log(`[bot → ${sender}] ${text}`);
    try {
      await ilink.sendText(acc, sender, text, r.contextToken);
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
          state.ctx[m.from_user_id] = { account: id, contextToken: m.context_token };
          save();
          console.log(`[${m.from_user_id} → bot] ${text}`);
          await handleAndDump(m.from_user_id, text);
        }
      } catch (e: any) {
        console.log(`[weixin] ${id} error: ${e.message}`);
        await sleep(3000);
      }
    }
  };
  await Promise.all(Object.entries(accounts).map(([id, acc]) => loop(id, acc)));
}
