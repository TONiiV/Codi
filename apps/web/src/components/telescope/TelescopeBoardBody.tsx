import { TasksPage } from "./TasksPage";
import type { TelescopeView } from "./telescopeViews";

/** Views backed by real board data; the others keep the shell's empty state. */
export function telescopeBoardBody(view: TelescopeView) {
  return view === "tasks" ? <TasksPage /> : undefined;
}
