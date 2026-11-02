// PROTOTYPE, wipe me. What a Chief of Staff created from a side chat (tasks, tickets, Workers),
// and requests to open a task in the side chat. In-memory only; the real thing is Lighthouse
// state that syncs to every member of the workspace.
import { useSyncExternalStore } from "react";

import {
  BOTS,
  PROJECT_COS,
  TASKS,
  projectsIn,
  type LighthouseBot,
  type LighthouseTask,
  type LighthouseViewer,
} from "./lighthouseData";

type Ticket = LighthouseTask["tickets"][number];

interface Store {
  tasks: ReadonlyArray<LighthouseTask>;
  tickets: Readonly<Record<string, ReadonlyArray<Ticket>>>;
  workers: ReadonlyArray<LighthouseBot>;
  request: { seq: number; chat: string; task: string } | null;
}

let store: Store = { tasks: [], tickets: {}, workers: [], request: null };
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

/** Seed tasks plus what was created, with created tickets attached to their task. */
export function useAllTasks(): ReadonlyArray<LighthouseTask> {
  const s = useStore();
  return [...TASKS, ...s.tasks].map((t) =>
    s.tickets[t.id] ? { ...t, tickets: [...t.tickets, ...s.tickets[t.id]!] } : t,
  );
}

export function useAllBots(): ReadonlyArray<LighthouseBot> {
  return [...BOTS, ...useStore().workers];
}

export function useSideChatRequest() {
  return useStore().request;
}

export function findTask(id: string): LighthouseTask | undefined {
  const t = [...TASKS, ...store.tasks].find((x) => x.id === id);
  return t && store.tickets[t.id] ? { ...t, tickets: [...t.tickets, ...store.tickets[t.id]!] } : t;
}

/** The agent that owns a task: its project's Chief of Staff, or the desk for desk tasks. */
export function taskAgent(task: LighthouseTask, viewer: LighthouseViewer, workspace: string) {
  if (task.assignees.some((a) => a.kind === "bot" && a.name === "总台")) return "desk";
  return projectsIn(workspace, viewer).open.includes(task.project) ? task.project : "mine";
}

export function openTaskInSideChat(chat: string, task: string) {
  update({ request: { seq: (store.request?.seq ?? 0) + 1, chat, task } });
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
