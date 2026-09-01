import { CAPTURE_SEED, CAPTURE_TABS, TODOS } from "../mock/calendar";
import { AGENTS, PERSONAS, TEAMS } from "../mock/personas";
import { PROJECTS } from "../mock/projects";
import { MENTIONED_POOL, REPLY_POOL, type ReplyTemplate } from "../mock/replies";
import { SEED_MESSAGES, THREADS } from "../mock/threads";
import type {
  Agent,
  AgentStatus,
  CaptureNote,
  DecisionNode,
  Message,
  ProviderId,
  Todo,
  TodoLabel,
} from "../mock/types";
import { createStore, createUseStore } from "./store";

export type Section = "today" | "agents" | "projects" | "calendar";
export type FocusMode = "all" | "day" | "hours3";
export type CalendarView = "agenda" | "gantt";

/** Calendar fixtures are expressed as offsets from the moment the app booted. */
export const BOOT_TIME = Date.now();

export type AppState = {
  personaId: string;
  section: Section;
  threadByPersona: Record<string, string>;
  projectByPersona: Record<string, string>;
  selectedAgentId: string | null;
  agents: Agent[];
  messages: Message[];
  participants: Record<string, string[]>;
  busyThreads: Record<string, boolean>;
  captureTabId: string;
  captures: CaptureNote[];
  calendarView: CalendarView;
  focus: FocusMode;
  /** Empty means "no filter", which reads better than a null sentinel here. */
  projectFilters: string[];
  labelFilters: TodoLabel[];
  paletteOpen: boolean;
  expandedTools: Record<string, boolean>;
  collapsedNodes: Record<string, boolean>;
};

function firstThreadFor(personaId: string): string {
  return THREADS.find((t) => t.personaId === personaId)?.id ?? "";
}

function firstProjectFor(personaId: string): string {
  return PROJECTS.find((p) => p.personaId === personaId)?.id ?? "";
}

/** Deep branches start folded so the tree reads as a shape, not a wall. */
function initialCollapsedNodes(): Record<string, boolean> {
  const collapsed: Record<string, boolean> = {};
  const walk = (node: DecisionNode, depth: number) => {
    if (depth >= 2 && node.children?.length) collapsed[node.id] = true;
    node.children?.forEach((child) => walk(child, depth + 1));
  };
  PROJECTS.forEach((project) => walk(project.decisions, 0));
  return collapsed;
}

const store = createStore<AppState>({
  personaId: PERSONAS[0]!.id,
  section: "today",
  threadByPersona: Object.fromEntries(PERSONAS.map((p) => [p.id, firstThreadFor(p.id)])),
  projectByPersona: Object.fromEntries(PERSONAS.map((p) => [p.id, firstProjectFor(p.id)])),
  selectedAgentId: null,
  agents: AGENTS,
  messages: SEED_MESSAGES,
  participants: Object.fromEntries(THREADS.map((t) => [t.id, t.participantIds])),
  busyThreads: {},
  captureTabId: CAPTURE_TABS[0]!.id,
  captures: CAPTURE_SEED,
  calendarView: "agenda",
  focus: "all",
  projectFilters: [],
  labelFilters: [],
  paletteOpen: false,
  expandedTools: {},
  collapsedNodes: initialCollapsedNodes(),
});

export const useApp = createUseStore(store);
export const getState = store.get;

// ── static lookups ─────────────────────────────────────────────────────────

export const personaList = PERSONAS;
export const captureTabs = CAPTURE_TABS;
export const allTodos = TODOS;

export function personaById(id: string) {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]!;
}

export function projectById(id: string) {
  return PROJECTS.find((p) => p.id === id);
}

export function threadById(id: string) {
  return THREADS.find((t) => t.id === id);
}

export function threadsFor(personaId: string) {
  return THREADS.filter((t) => t.personaId === personaId);
}

export function projectsFor(personaId: string) {
  return PROJECTS.filter((p) => p.personaId === personaId);
}

export function teamsFor(personaId: string) {
  return TEAMS.filter((t) => t.personaId === personaId);
}

export function agentsFor(state: AppState, personaId: string) {
  return state.agents.filter((a) => a.personaId === personaId);
}

export function agentById(state: AppState, id: string | null | undefined) {
  return id ? state.agents.find((a) => a.id === id) : undefined;
}

export function todosFor(personaId: string) {
  return TODOS.filter((t) => t.personaId === personaId);
}

export function todoStart(todo: Todo) {
  return new Date(BOOT_TIME + todo.startH * 3_600_000);
}

export function todoEnd(todo: Todo) {
  return new Date(BOOT_TIME + (todo.startH + todo.durH) * 3_600_000);
}

export function currentThreadId(state: AppState) {
  return state.threadByPersona[state.personaId] ?? "";
}

export function currentProjectId(state: AppState) {
  return state.projectByPersona[state.personaId] ?? "";
}

/** The agent that answers when the human does not @-mention anyone. */
export function leadAgentId(state: AppState, threadId: string) {
  return state.participants[threadId]?.[0] ?? null;
}

// ── navigation ─────────────────────────────────────────────────────────────

export function selectPersona(personaId: string) {
  store.set((s) => (s.personaId === personaId ? s : { ...s, personaId, selectedAgentId: null }));
}

export function setSection(section: Section) {
  store.set((s) => (s.section === section ? s : { ...s, section }));
}

export function selectThread(threadId: string) {
  store.set((s) => ({
    ...s,
    threadByPersona: { ...s.threadByPersona, [s.personaId]: threadId },
  }));
}

export function selectProject(projectId: string) {
  store.set((s) => ({
    ...s,
    projectByPersona: { ...s.projectByPersona, [s.personaId]: projectId },
  }));
}

/** Selecting an agent also jumps to a thread they speak in, so the click pays off. */
export function selectAgent(agentId: string) {
  store.set((s) => {
    const next = s.selectedAgentId === agentId ? null : agentId;
    if (!next) return { ...s, selectedAgentId: null };
    const thread = THREADS.find(
      (t) => t.personaId === s.personaId && (s.participants[t.id] ?? []).includes(agentId),
    );
    return {
      ...s,
      selectedAgentId: next,
      threadByPersona: thread
        ? { ...s.threadByPersona, [s.personaId]: thread.id }
        : s.threadByPersona,
    };
  });
}

export function setPalette(open: boolean) {
  store.set((s) => (s.paletteOpen === open ? s : { ...s, paletteOpen: open }));
}

// ── agent configuration ────────────────────────────────────────────────────

export function setAgentProvider(agentId: string, provider: ProviderId, model: string) {
  store.set((s) => ({
    ...s,
    agents: s.agents.map((a) => (a.id === agentId ? { ...a, provider, model } : a)),
  }));
}

export function setAgentModel(agentId: string, model: string) {
  store.set((s) => ({
    ...s,
    agents: s.agents.map((a) => (a.id === agentId ? { ...a, model } : a)),
  }));
}

function setAgentStatus(agentId: string, status: AgentStatus, activity?: string) {
  store.set((s) => ({
    ...s,
    agents: s.agents.map((a) =>
      a.id === agentId ? { ...a, status, activity: activity ?? a.activity } : a,
    ),
  }));
}

// ── today: quick capture ───────────────────────────────────────────────────

export function setCaptureTab(tabId: string) {
  store.set((s) => (s.captureTabId === tabId ? s : { ...s, captureTabId: tabId }));
}

export function addCapture(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  store.set((s) => ({
    ...s,
    captures: [
      { id: nextId("cn"), tabId: s.captureTabId, text: trimmed, time: clockLabel() },
      ...s.captures,
    ],
  }));
}

// ── calendar ───────────────────────────────────────────────────────────────

export function setCalendarView(view: CalendarView) {
  store.set((s) => (s.calendarView === view ? s : { ...s, calendarView: view }));
}

export function setFocus(focus: FocusMode) {
  store.set((s) => (s.focus === focus ? s : { ...s, focus }));
}

export function toggleProjectFilter(projectId: string) {
  store.set((s) => ({
    ...s,
    projectFilters: s.projectFilters.includes(projectId)
      ? s.projectFilters.filter((id) => id !== projectId)
      : [...s.projectFilters, projectId],
  }));
}

export function toggleLabelFilter(label: TodoLabel) {
  store.set((s) => ({
    ...s,
    labelFilters: s.labelFilters.includes(label)
      ? s.labelFilters.filter((l) => l !== label)
      : [...s.labelFilters, label],
  }));
}

export function clearFilters() {
  store.set((s) => ({ ...s, projectFilters: [], labelFilters: [] }));
}

// ── disclosure ─────────────────────────────────────────────────────────────

export function toggleTool(toolId: string) {
  store.set((s) => ({
    ...s,
    expandedTools: { ...s.expandedTools, [toolId]: !s.expandedTools[toolId] },
  }));
}

export function toggleNode(nodeId: string) {
  store.set((s) => ({
    ...s,
    collapsedNodes: { ...s.collapsedNodes, [nodeId]: !s.collapsedNodes[nodeId] },
  }));
}

// ── conversation ───────────────────────────────────────────────────────────

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function clockLabel() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function appendMessage(message: Message) {
  store.set((s) => ({ ...s, messages: [...s.messages, message] }));
}

function patchMessage(id: string, patch: Partial<Message>) {
  store.set((s) => ({
    ...s,
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }));
}

function setBusy(threadId: string, busy: boolean) {
  store.set((s) => ({ ...s, busyThreads: { ...s.busyThreads, [threadId]: busy } }));
}

/**
 * Adds an agent to a thread it has not spoken in yet and drops a join rule in
 * the transcript, so a mention that pulls in a stranger is visible.
 */
function ensureParticipant(threadId: string, agentId: string) {
  const state = store.get();
  if ((state.participants[threadId] ?? []).includes(agentId)) return;
  store.set((s) => ({
    ...s,
    participants: {
      ...s.participants,
      [threadId]: [...(s.participants[threadId] ?? []), agentId],
    },
  }));
  appendMessage({
    id: nextId("jm"),
    threadId,
    authorId: agentId,
    kind: "join",
    text: "",
    time: clockLabel(),
  });
}

export function parseMentions(text: string, agents: Agent[]): Agent[] {
  return agents
    .map((agent) => ({ agent, at: text.indexOf(`@${agent.name}`) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.agent);
}

/** Rotates through an agent's canned replies so repeated sends do not loop. */
const poolCursor = new Map<string, number>();
function pickTemplate(
  agentId: string,
  pool: Record<string, ReplyTemplate[]>,
): ReplyTemplate {
  const options = pool[agentId] ?? pool.a_default!;
  const key = `${agentId}:${options === pool.a_default ? "d" : "a"}`;
  const index = poolCursor.get(key) ?? 0;
  poolCursor.set(key, index + 1);
  return options[index % options.length]!;
}

function pickTeammate(threadId: string, speaker: Agent): Agent | undefined {
  const state = store.get();
  const inThread = (state.participants[threadId] ?? [])
    .map((id) => agentById(state, id))
    .filter((a): a is Agent => Boolean(a) && a!.id !== speaker.id);
  if (inThread.length > 0) {
    return inThread[Math.floor(Math.random() * inThread.length)];
  }
  return agentsFor(state, speaker.personaId).find((a) => a.id !== speaker.id);
}

type Turn = { agent: Agent; mentionedBy?: string; allowHandoff: boolean };

/**
 * Fake streaming: ~30ms ticks writing a few characters at a time. Only the
 * streaming message subscribes to its own text, so this does not repaint the
 * transcript.
 */
function streamInto(messageId: string, full: string, done: () => void) {
  let cursor = 0;
  const timer = window.setInterval(() => {
    cursor += 2 + Math.floor(Math.random() * 3);
    if (cursor >= full.length) {
      window.clearInterval(timer);
      patchMessage(messageId, { text: full, streaming: false });
      done();
      return;
    }
    patchMessage(messageId, { text: full.slice(0, cursor) });
  }, 30);
}

function respond(threadId: string, turn: Turn, done: (handoff?: Agent) => void) {
  const { agent, mentionedBy, allowHandoff } = turn;
  ensureParticipant(threadId, agent.id);
  setAgentStatus(agent.id, "thinking", "正在读取上下文");

  const template = pickTemplate(agent.id, mentionedBy ? MENTIONED_POOL : REPLY_POOL);
  let handoff: Agent | undefined;
  let text = template.text;
  if (allowHandoff && template.handoff) {
    handoff = pickTeammate(threadId, agent);
    if (handoff) text += `\n\n${template.handoff.replace("{@}", `@${handoff.name}`)}`;
  }

  const messageId = nextId("am");
  const toolCalls = template.toolCalls?.map((call, index) => ({
    ...call,
    id: `${messageId}-tc${index}`,
  }));

  window.setTimeout(() => {
    if (toolCalls) setAgentStatus(agent.id, "tool", `正在${toolCalls[0]!.title}`);
    appendMessage({
      id: messageId,
      threadId,
      authorId: agent.id,
      replyToId: mentionedBy,
      text: "",
      time: clockLabel(),
      streaming: true,
      toolCalls,
    });

    window.setTimeout(
      () => {
        setAgentStatus(agent.id, "thinking", "正在组织回复");
        streamInto(messageId, text, () => {
          if (template.diff) patchMessage(messageId, { diff: template.diff });
          setAgentStatus(agent.id, "idle", "刚刚回复完一条消息");
          done(handoff);
        });
      },
      toolCalls ? 900 : 120,
    );
  }, 420);
}

function runTurns(threadId: string, turns: Turn[]) {
  const [head, ...rest] = turns;
  if (!head) {
    setBusy(threadId, false);
    return;
  }
  respond(threadId, head, (handoff) => {
    const queued: Turn[] = handoff
      ? [...rest, { agent: handoff, mentionedBy: head.agent.id, allowHandoff: false }]
      : rest;
    runTurns(threadId, queued);
  });
}

export function sendMessage(raw: string) {
  const text = raw.trim();
  if (!text) return;
  const state = store.get();
  const threadId = currentThreadId(state);
  if (!threadId || state.busyThreads[threadId]) return;

  appendMessage({
    id: nextId("um"),
    threadId,
    authorId: "user",
    text,
    time: clockLabel(),
  });

  const roster = agentsFor(state, state.personaId);
  const mentioned = parseMentions(text, roster);
  const lead = agentById(state, leadAgentId(state, threadId));
  const responders = mentioned.length > 0 ? mentioned : lead ? [lead] : [];
  if (responders.length === 0) return;

  setBusy(threadId, true);
  runTurns(
    threadId,
    responders.map((agent, index) => ({
      agent,
      allowHandoff: index === 0 && responders.length === 1,
    })),
  );
}
