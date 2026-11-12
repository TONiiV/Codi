import { useNavigate } from "@tanstack/react-router";
import { CircleUserIcon, Columns3Icon, GitBranchIcon, TableIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { DecisionsBody } from "./DecisionsPage";
import { TelescopeEmptyState } from "./TelescopeShell";
import { telescopeBoard } from "./telescopeState";
import {
  BoardFrame,
  type BoardTarget,
  isMyTask,
  NoWorkspace,
  useBoardCommand,
  useBoardTarget,
  useTaskAccess,
} from "./TasksParts";
import { useTasksProject } from "./TasksSidebar";
import { type CreateTask, TasksBoard, TasksTable } from "./TasksViews";
import {
  type TasksLayout,
  telescopeSearch,
  useTasksLayout,
  useTasksProjectId,
} from "./telescopeViews";

/** Notion's view tabs: pills in one row, the selected one filled. */
function TasksTabs({ layout }: { layout: TasksLayout }) {
  const navigate = useNavigate();
  const project = useTasksProjectId();
  const tab = (id: TasksLayout, label: string, Icon: typeof TableIcon) => (
    <Button
      size="sm-pill"
      variant={layout === id ? "secondary" : "ghost-muted"}
      aria-pressed={layout === id}
      onClick={() =>
        void navigate({
          to: TELESCOPE_PATH,
          search: telescopeSearch("tasks", id, { project }),
          replace: true,
        })
      }
    >
      <Icon /> {label}
    </Button>
  );
  return (
    <>
      {tab("table", "表格", TableIcon)}
      {tab("board", "按状态", Columns3Icon)}
      {tab("mine", "我的", CircleUserIcon)}
      {tab("decisions", "决定", GitBranchIcon)}
    </>
  );
}

function TasksHeader({ target, layout }: { target: BoardTarget; layout: TasksLayout }) {
  const { list, selected } = useTasksProject(target);
  // Decisions have no project, so their list always covers the whole workspace.
  const name =
    layout === "decisions" ? undefined : list?.find((project) => project.id === selected)?.name;
  return (
    <header className="px-4 pt-8 pb-3 sm:px-24 sm:pt-12">
      <h2 className="text-3xl font-bold wrap-anywhere">{name ?? "全部任务"}</h2>
      <p className="mt-1 text-sm">所有成员和 agents 实时看到同一块板。</p>
    </header>
  );
}

function TasksBody(props: { target: BoardTarget; layout: TasksLayout; tabs: ReactNode }) {
  const { target, layout } = props;
  const { environmentId, workspaceId } = target;
  const { selected: projectId } = useTasksProject(target);
  const { self, mayEdit, mayCreate } = useTaskAccess(target);
  const input = { workspaceId, ...(projectId === undefined ? {} : { projectId }) };
  const query = useEnvironmentQuery(telescopeBoard.tasks({ environmentId, input }));
  const myAgents = useEnvironmentQuery(
    telescopeBoard.agents({ environmentId, input: { workspaceId } }),
  ).data?.agents;
  const createTask = useBoardCommand(telescopeBoard.createTask);
  const all = query.data?.tasks ?? [];
  const mine = new Set(myAgents?.map((agent) => agent.id));
  const tasks =
    layout === "mine" ? all.filter((task) => isMyTask(task, self?.subjectId, mine)) : all;
  const create: CreateTask = mayCreate
    ? (title, set) => createTask({ environmentId, input: { ...input, ...set, title } })
    : null;
  return (
    <BoardFrame query={query} actions={props.tabs}>
      {tasks.length === 0 && create === null ? (
        <TelescopeEmptyState
          view="tasks"
          {...(layout === "mine"
            ? { title: "还没有你的任务", description: "负责人是你或你的 agent 的任务会列在这里。" }
            : projectId === undefined
              ? {}
              : { title: "这个项目还没有任务", description: "任务归到这个项目后，会列在这里。" })}
        />
      ) : layout === "board" ? (
        <TasksBoard target={target} tasks={tasks} mayEdit={mayEdit} create={create} />
      ) : (
        <TasksTable
          target={target}
          tasks={tasks}
          layout={layout === "mine" ? "mine" : "table"}
          mayEdit={mayEdit}
          create={create}
          {...(layout === "mine" && self ? { createSet: { ownerSubjectId: self.subjectId } } : {})}
        />
      )}
    </BoardFrame>
  );
}

export function TasksPage() {
  const target = useBoardTarget();
  const layout = useTasksLayout();
  if (target === null) return <NoWorkspace />;
  const tabs = <TasksTabs layout={layout} />;
  return (
    <>
      <TasksHeader target={target} layout={layout} />
      {layout === "decisions" ? (
        <DecisionsBody target={target} actions={tabs} />
      ) : (
        <TasksBody target={target} layout={layout} tabs={tabs} />
      )}
    </>
  );
}
