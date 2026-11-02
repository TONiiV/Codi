// PROTOTYPE, wipe me. What a Chief of Staff created from a side chat (tasks, tickets, Workers),
// and requests to open a task in the side chat. In-memory only; the real thing is Lighthouse
// state that syncs to every member of the workspace.
import { useSyncExternalStore } from "react";

import {
  BOTS,
  PROJECTS,
  PROJECT_COS,
  TASKS,
  projectsIn,
  registerProject,
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
  cos: Readonly<Record<string, CosSetup>>;
  linked: ReadonlyArray<string>;
  request: SideChatRequest | null;
}

export type CosPower = "ticket" | "worker" | "answer" | "merge";

/** How a project's Chief of Staff is set up, and what it may do without asking its owner. */
export interface CosSetup {
  name: string;
  owner: string;
  harness: string;
  machine: string;
  powers: ReadonlyArray<CosPower>;
  report: "daily" | "weekly";
}

/** What the Chief of Staff did when a task was dragged into 进行中. */
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
  cos: {},
  linked: [],
  request: null,
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
  if (!tickets && !status) return t;
  return {
    ...t,
    ...(status ? { status } : {}),
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

/** The agent that owns a task: its project's Chief of Staff, or the desk for desk tasks. */
export function taskAgent(task: LighthouseTask, viewer: LighthouseViewer, workspace: string) {
  if (task.assignees.some((a) => a.kind === "bot" && a.name === "总台")) return "desk";
  return projectsIn(workspace, viewer).open.includes(task.project) ? task.project : "mine";
}

export function openTaskInSideChat(chat: string, task: string, kickoff?: Kickoff) {
  const seq = (store.request?.seq ?? 0) + 1;
  update({ request: kickoff ? { seq, chat, task, kickoff } : { seq, chat, task } });
}

/**
 * Moving a task on the board. Into 进行中 from 待开始 means "start it": the Chief of Staff
 * puts a Worker on its first unclaimed ticket, opening one if needed, or chases the Workers
 * already on it, and reports in the side chat.
 */
export function moveTask(task: LighthouseTask, status: TaskStatus, chat: string) {
  if (task.status === status) return;
  update({ status: { ...store.status, [task.id]: status } });
  if (task.status !== "todo" || status !== "doing") return;
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

function defaultCos(project: string): CosSetup {
  return {
    name: PROJECT_COS[project]?.name ?? `${project} 幕僚长`,
    owner: PROJECTS[project]?.lead ?? "Tonic",
    harness: "Codi 滚动线程 / Sonnet",
    machine: "lighthouse-01",
    powers: ["ticket", "worker", "answer"],
    report: "daily",
  };
}

export function useCosSetup(project: string): CosSetup {
  return useStore().cos[project] ?? defaultCos(project);
}

/** Re-renders a view when projects are linked, since their registries live outside React. */
export function useLinkedProjects(): ReadonlyArray<string> {
  return useStore().linked;
}

export function saveCos(project: string, setup: CosSetup) {
  const cos = PROJECT_COS[project];
  if (cos) PROJECT_COS[project] = { ...cos, name: setup.name };
  update({ cos: { ...store.cos, [project]: setup } });
}

/** Turns a Code project into a Lighthouse project: same record, plus a Chief of Staff. */
export function linkProject(
  source: { title: string; root: string; repo: string; machine: string },
  workspace: string,
  viewer: LighthouseViewer,
  setup: CosSetup,
) {
  const id = `p${store.linked.length + 1}`;
  registerProject(
    id,
    { name: source.title, workspace, lead: setup.owner, cos: setup.name, viewer },
    { root: source.root, repo: source.repo, machine: source.machine },
  );
  update({ linked: [...store.linked, id], cos: { ...store.cos, [id]: setup } });
  return id;
}
