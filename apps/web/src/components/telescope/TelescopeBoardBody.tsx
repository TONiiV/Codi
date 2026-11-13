import { TasksPage } from "./TasksPage";
import { TelescopeProjectsPage } from "./TelescopeProjectsPage";
import type { TelescopeView } from "./telescopeViews";

/** Views backed by real board data; the others keep the shell's empty state. */
export function telescopeBoardBody(view: TelescopeView) {
  if (view === "tasks") return <TasksPage />;
  if (view === "projects") return <TelescopeProjectsPage />;
  return undefined;
}
