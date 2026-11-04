// PROTOTYPE, wipe me. What a Chief Agent created from a side chat (tasks, tickets, Workers),
// and requests to open a task in the side chat. In-memory only; the real thing is Lighthouse
// state that syncs to every member of the workspace.
import { useSyncExternalStore } from "react";

import {
  BOTS,
  CHIEF_NAMES,
  COMPANY_AGENTS,
  CUSTOM_AGENTS,
  NO_CHIEF,
  PROJECT_COS,
  TASKS,
  VIEWERS,
  chiefName,
  chiefProjects,
  customAgent,
  registerProject,
  type CompanyAgent,
  type LighthouseBot,
  type LighthouseTask,
  type LighthouseViewer,
  type TaskStatus,
} from "./lighthouseData";

type Ticket = LighthouseTask["tickets"][number];

interface Store {
  tasks: ReadonlyArray<LighthouseTask>;
  tickets: Readonly<Record<string, ReadonlyArray<Ticket>>>;
  workers: ReadonlyArray<LighthouseBot>;
  status: Readonly<Record<string, TaskStatus>>;
  leases: Readonly<Record<string, NonNullable<LighthouseTask["lease"]>>>;
  cos: Readonly<Record<string, CosSetup>>;
  linked: ReadonlyArray<string>;
  version: number;
  request: SideChatRequest | null;
  teamsTab: TeamsTab;
}

export type TeamsTab = "mine" | "company" | "skills";

export type CosPower = "ticket" | "worker" | "answer" | "merge";

/**
 * How one of the viewer's own agents is set up: their Chief of Staff, or their Chief Agent in a
 * project. Powers are what it may do without asking its owner, capped by the owner's role.
 */
export interface CosSetup {
  name: string;
  harness: string;
  powers: ReadonlyArray<CosPower>;
  report: "daily" | "weekly";
  /** Takes a lease on the shared task board before work and writes a report back after. */
  board: boolean;
  /** The company main agent may hand it work. */
  dispatchable: boolean;
  onDispatch: "start" | "inbox";
}

/** What the project Chief Agent did when a task was dragged into 进行中. */
export interface Kickoff {
  ticket: Ticket;
  worker: string;
  fresh: boolean;
}

interface SideChatRequest {
  seq: number;
  chat: string;
  task: string;
  kickoff?: Kickoff;
}

let store: Store = {
  tasks: [],
  tickets: {},
  workers: [],
  status: {},
  leases: {},
  cos: {},
  linked: [],
  version: 0,
  request: null,
  teamsTab: "mine",
};
const listeners = new Set<() => void>();

function update(next: Partial<Store>) {
  store = { ...store, ...next };
  for (const l of listeners) l();
}

function useStore(): Store {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => store,
  );
}

function withChanges(s: Store, t: LighthouseTask): LighthouseTask {
  const tickets = s.tickets[t.id];
  const status = s.status[t.id];
  const lease = s.leases[t.id];
  if (!tickets && !status && !lease) return t;
  return {
    ...t,
    ...(status ? { status } : {}),
    ...(lease ? { lease } : {}),
    tickets: tickets ? [...t.tickets, ...tickets] : t.tickets,
  };
}

/** Seed tasks plus what was created, with created tickets and moves applied. */
export function useAllTasks(): ReadonlyArray<LighthouseTask> {
  const s = useStore();
  return [...TASKS, ...s.tasks].map((t) => withChanges(s, t));
}

export function useAllBots(): ReadonlyArray<LighthouseBot> {
  return [...BOTS, ...useStore().workers];
}

export function useSideChatRequest() {
  return useStore().request;
}

export function findTask(id: string): LighthouseTask | undefined {
  const t = [...TASKS, ...store.tasks].find((x) => x.id === id);
  return t ? withChanges(store, t) : undefined;
}

/** The agent that owns a task: the viewer's Chief Agent in its project, or 主代理 for its own. */
export function taskAgent(task: LighthouseTask, viewer: LighthouseViewer, workspace: string) {
  if (task.assignees.some((a) => a.kind === "bot" && a.name === "主代理")) return "desk";
  return chiefProjects(workspace, viewer).includes(task.project) ? task.project : "mine";
}

export function openTaskInSideChat(chat: string, task: string, kickoff?: Kickoff) {
  const seq = (store.request?.seq ?? 0) + 1;
  update({ request: kickoff ? { seq, chat, task, kickoff } : { seq, chat, task } });
}

/**
 * Moving a task on the board. Into 进行中 from 待开始 means "start it": the project Chief Agent
 * puts a Worker on its first unclaimed ticket, opening one if needed, or chases the Workers
 * already on it, and reports in the side chat.
 */
export function moveTask(
  task: LighthouseTask,
  status: TaskStatus,
  chat: string,
  viewer: LighthouseViewer,
) {
  if (task.status === status) return;
  update({ status: { ...store.status, [task.id]: status } });
  if (task.status !== "todo" || status !== "doing") return;
  if (!task.lease) {
    const lease = { owner: VIEWERS[viewer].name, until: "12:30" };
    update({ leases: { ...store.leases, [task.id]: lease } });
  }
  const busy = task.tickets.find((t) => t.state !== "merged" && t.worker);
  if (busy) {
    openTaskInSideChat(chat, task.id, { ticket: busy, worker: busy.worker!, fresh: false });
    return;
  }
  const ticket =
    task.tickets.find((t) => t.state === "open" && !t.worker) ??
    createTicket(task, `开干：${task.title}`);
  const worker = createWorker(task, ticket);
  openTaskInSideChat(chat, task.id, { ticket, worker: worker.id, fresh: true });
}

const prefix = (project: string) => (project === "codi" ? "codi" : project);

export function createTicket(task: LighthouseTask, title: string): Ticket {
  const n = 40 + Object.values(store.tickets).flat().length + task.tickets.length;
  const ticket: Ticket = { id: `${prefix(task.project)}#${n}`, title, state: "open" };
  update({
    tickets: { ...store.tickets, [task.id]: [...(store.tickets[task.id] ?? []), ticket] },
  });
  return ticket;
}

export function createWorker(task: LighthouseTask, ticket: Ticket): LighthouseBot {
  const id = `W${25 + store.workers.length}`;
  const worker: LighthouseBot = {
    id,
    name: id,
    kind: "worker",
    tone: PROJECT_COS[task.project]?.tone ?? "bg-primary",
    harness: "Codex / gpt-5",
    where: "lighthouse-01",
    status: `刚启动 · ${ticket.id}`,
    online: true,
    project: task.project,
  };
  const tickets = (store.tickets[task.id] ?? []).map((t) =>
    t.id === ticket.id ? { ...t, worker: id } : t,
  );
  update({
    workers: [...store.workers, worker],
    tickets: { ...store.tickets, [task.id]: tickets },
  });
  return worker;
}

export function createTask(from: LighthouseTask, title: string): LighthouseTask {
  const cos = PROJECT_COS[from.project];
  const task: LighthouseTask = {
    id: `T-${31 + store.tasks.length}`,
    title,
    project: from.project,
    status: "todo",
    assignees: cos ? [{ kind: "bot", name: cos.name, tone: cos.tone }] : [],
    tickets: [],
  };
  update({ tasks: [...store.tasks, task] });
  return task;
}

const cosKey = (viewer: LighthouseViewer, project: string | null) =>
  `${viewer}:${project ?? "cos"}`;

// The version argument keeps the React Compiler from caching names read from module data.
function defaultCos(viewer: LighthouseViewer, project: string | null, _version: number): CosSetup {
  return {
    name: project ? chiefName(viewer, project) : VIEWERS[viewer].cos.name,
    harness: "Codi 滚动线程 / Sonnet",
    powers: project && !customAgent(project) ? ["ticket", "worker", "answer"] : ["answer"],
    report: "daily",
    board: true,
    dispatchable: true,
    onDispatch: "inbox",
  };
}

/** `project` null is the viewer's Chief of Staff. */
export function useCosSetup(viewer: LighthouseViewer, project: string | null): CosSetup {
  const s = useStore();
  const saved = s.cos[cosKey(viewer, project)];
  return saved ? saved : defaultCos(viewer, project, s.version);
}

/**
 * Bumps when a project is linked or an agent renamed. Those registries are module data, so a
 * view passes this into what it derives from them, or the React Compiler keeps the old value.
 */
export function useRegistryVersion(): number {
  return useStore().version;
}

const viewerAt = (viewer: LighthouseViewer, _version: number) => ({
  ...VIEWERS[viewer],
  cos: { ...VIEWERS[viewer].cos },
});

export function useViewer(viewer: LighthouseViewer) {
  return viewerAt(viewer, useStore().version);
}

/** Only the viewer renames their own Chief of Staff. */
export function renameChiefOfStaff(viewer: LighthouseViewer, name: string) {
  VIEWERS[viewer].cos = { name };
  const key = cosKey(viewer, null);
  const saved = store.cos[key];
  update({
    version: store.version + 1,
    ...(saved ? { cos: { ...store.cos, [key]: { ...saved, name } } } : {}),
  });
}

/** A member renames and sets up only their own agents; nobody else's Chief Agent changes. */
export function saveCos(viewer: LighthouseViewer, project: string | null, setup: CosSetup) {
  if (project) CHIEF_NAMES[`${viewer}:${project}`] = setup.name;
  else VIEWERS[viewer].cos = { name: setup.name };
  update({ cos: { ...store.cos, [cosKey(viewer, project)]: setup }, version: store.version + 1 });
}

/** The viewer adds their own Chief Agent to a project they are in. */
export function addChiefAgent(viewer: LighthouseViewer, project: string, setup: CosSetup) {
  NO_CHIEF.delete(`${viewer}:${project}`);
  saveCos(viewer, project, setup);
}

/** A custom agent is personal: it belongs to the viewer in one workspace. */
export function addCustomAgent(
  viewer: LighthouseViewer,
  workspace: string,
  skills: ReadonlyArray<string>,
  setup: CosSetup,
) {
  const id = `custom-${CUSTOM_AGENTS.length + 1}`;
  CUSTOM_AGENTS.push({ id, viewer, workspace, skills });
  saveCos(viewer, id, setup);
  return id;
}

/** Only a company admin changes a company agent; the UI checks, the real server would too. */
export function saveCompanyAgent(id: string, patch: Pick<CompanyAgent, "name" | "owner" | "can">) {
  const i = COMPANY_AGENTS.findIndex((a) => a.id === id);
  if (i < 0) return;
  COMPANY_AGENTS[i] = { ...COMPANY_AGENTS[i]!, ...patch };
  update({ version: store.version + 1 });
}

/** Turns a Code project into a Lighthouse project led by the viewer, with their Chief Agent. */
export function linkProject(
  source: { title: string; root: string; repo: string; machine: string },
  workspace: string,
  viewer: LighthouseViewer,
  setup: CosSetup,
) {
  const id = `p${store.linked.length + 1}`;
  registerProject(
    id,
    { name: source.title, workspace, lead: VIEWERS[viewer].name, cos: setup.name, viewer },
    { root: source.root, repo: source.repo, machine: source.machine },
  );
  update({
    linked: [...store.linked, id],
    cos: { ...store.cos, [cosKey(viewer, id)]: setup },
    version: store.version + 1,
  });
  return id;
}

/** My Teams has one tab state, shared by its own tabs and the sidebar list next to it. */
export function useTeamsTab(): TeamsTab {
  return useStore().teamsTab;
}

export function setTeamsTab(tab: TeamsTab) {
  update({ teamsTab: tab });
}
