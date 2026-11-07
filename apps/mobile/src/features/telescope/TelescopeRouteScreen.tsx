import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SelectionRow } from "../../components/ui/SelectionRow";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { type EnvironmentQueryView, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { telescopeBoard } from "./telescopeAtoms";
import {
  decideInput,
  describeFailure,
  formatBoardDate,
  reviewQueue,
  reviewUpdateInput,
  sortDecisions,
} from "./telescopeBoard";

type BoardView = "decisions" | "review";
const VIEW_OPTIONS = [
  { value: "decisions", label: "决定" },
  { value: "review", label: "确认" },
] as const satisfies readonly { value: BoardView; label: string }[];

interface Target {
  readonly environmentId: EnvironmentId;
  readonly workspaceId: Telescope.WorkspaceId;
}

const DECISION_STATUS_LABEL = { proposed: "待决定", decided: "已决定", superseded: "已被取代" };
const TASK_STATUS_LABEL: Partial<Record<Telescope.TaskStatus, string>> = {
  needs_decision: "等你决定",
  in_review: "等你确认",
};

function rowClassName(index: number) {
  return index === 0 ? "gap-2 px-4 py-3" : "gap-2 border-t border-border-subtle px-4 py-3";
}

function StatusText(props: { readonly text: string; readonly tone?: "danger" }) {
  return (
    <Text
      className={
        props.tone === "danger"
          ? "p-4 text-base text-danger-foreground"
          : "p-4 text-base text-foreground-muted"
      }
    >
      {props.text}
    </Text>
  );
}

function reportFailure(result: AtomCommandResult<unknown, unknown>, onStale: () => void) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const outcome = describeFailure(squashAtomCommandFailure(result));
  if (outcome.refresh) onStale();
  Dialog.alert(outcome.title, outcome.message);
}

export function TelescopeRouteScreen() {
  const insets = useSafeAreaInsets();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const { environments } = useEnvironments();
  const [view, setView] = useState<BoardView>("decisions");
  const [picking, setPicking] = useState(false);
  const stored = AsyncResult.isSuccess(preferences)
    ? preferences.value.telescopeWorkspace
    : undefined;
  const target: Target | null =
    stored && environments.some((environment) => environment.environmentId === stored.environmentId)
      ? {
          environmentId: EnvironmentId.make(stored.environmentId),
          workspaceId: Telescope.WorkspaceId.make(stored.workspaceId),
        }
      : null;
  const query = target
    ? { environmentId: target.environmentId, input: { workspaceId: target.workspaceId } }
    : null;
  const decisions = useEnvironmentQuery(query ? telescopeBoard.decisions(query) : null);
  const tasks = useEnvironmentQuery(query ? telescopeBoard.tasks(query) : null);
  const workspaces = useEnvironmentQuery(
    target ? telescopeBoard.workspaces({ environmentId: target.environmentId, input: {} }) : null,
  );
  const workspaceName =
    workspaces.data?.workspaces.find((workspace) => workspace.id === target?.workspaceId)?.name ??
    (workspaces.data ? "这个工作区已不可用" : workspaces.error ? "读取工作区失败" : "正在读取…");
  const select = (next: Target) => {
    savePreferences({ telescopeWorkspace: next });
    setPicking(false);
  };
  const showPicker = picking || target === null;

  return (
    <SettingsScreen
      title="Telescope"
      refresh={{
        accessibilityLabel: "刷新",
        disabled: target === null,
        onPress: () => {
          decisions.refresh();
          tasks.refresh();
        },
      }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {showPicker ? (
          environments.length === 0 ? (
            <StatusText text="先连接一个环境，才能看到它的工作区。" />
          ) : (
            environments.map((environment) => (
              <EnvironmentWorkspaces
                key={environment.environmentId}
                environmentId={environment.environmentId}
                label={environment.label}
                selected={target}
                onSelect={select}
              />
            ))
          )
        ) : (
          <SettingsSection
            title="工作区"
            trailing={
              <Button size="compact" tone="text" label="切换" onPress={() => setPicking(true)} />
            }
          >
            <StatusText
              text={workspaceName}
              tone={!workspaces.data && workspaces.error ? "danger" : undefined}
            />
          </SettingsSection>
        )}
        {target && !showPicker ? (
          <>
            <SegmentedControl
              options={VIEW_OPTIONS}
              selected={view}
              onSelect={setView}
              role="tab"
            />
            {view === "decisions" ? (
              <DecisionList target={target} query={decisions} />
            ) : (
              <ReviewList target={target} query={tasks} />
            )}
          </>
        ) : null}
      </ScrollView>
    </SettingsScreen>
  );
}

function EnvironmentWorkspaces(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly selected: Target | null;
  readonly onSelect: (target: Target) => void;
}) {
  const { environmentId } = props;
  const list = useEnvironmentQuery(telescopeBoard.workspaces({ environmentId, input: {} }));
  const workspaces = list.data?.workspaces ?? [];
  return (
    <SettingsSection title={props.label}>
      {list.error ? (
        <StatusText tone="danger" text={list.error} />
      ) : !list.data ? (
        <StatusText text="正在读取工作区…" />
      ) : workspaces.length === 0 ? (
        <StatusText text="你还没有加入这个环境里的工作区。" />
      ) : (
        workspaces.map((workspace, index) => (
          <SelectionRow
            key={workspace.id}
            title={workspace.name}
            subtitle={workspace.kind === "personal" ? "个人" : "团队"}
            selected={
              props.selected?.environmentId === environmentId &&
              props.selected.workspaceId === workspace.id
            }
            isFirst={index === 0}
            isLast={index === workspaces.length - 1}
            onPress={() => props.onSelect({ environmentId, workspaceId: workspace.id })}
          />
        ))
      )}
    </SettingsSection>
  );
}

function DecisionList(props: {
  readonly target: Target;
  readonly query: EnvironmentQueryView<typeof Telescope.DecisionListResult.Type>;
}) {
  const decide = useAtomCommand(telescopeBoard.decide, { reportFailure: false });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { query } = props;
  if (query.error) return <StatusText tone="danger" text={query.error} />;
  if (!query.data) return <StatusText text="正在读取决定…" />;
  const decisions = sortDecisions(query.data.decisions);
  if (decisions.length === 0) return <StatusText text="这个工作区还没有决定。" />;

  const choose = (proposal: Telescope.Decision, option: { id: string; label: string }) =>
    Dialog.confirm({
      title: `选择「${option.label}」？`,
      message: proposal.title,
      confirmText: "决定",
      cancelText: "取消",
      onConfirm: () => {
        setPendingId(proposal.id);
        void decide({
          environmentId: props.target.environmentId,
          input: decideInput(proposal, option.id),
        }).then((result) => {
          setPendingId(null);
          reportFailure(result, query.refresh);
        });
      },
    });

  return (
    <SettingsSection title="决定">
      {decisions.map((decision, index) => {
        const chosen = decision.options?.find((option) => option.id === decision.chosen);
        const date = formatBoardDate(
          decision.status === "decided"
            ? (decision.decidedAt ?? decision.updatedAt)
            : decision.status === "superseded"
              ? decision.updatedAt
              : decision.createdAt,
        );
        return (
          <View key={decision.id} className={rowClassName(index)}>
            <Text textRole="body" className="font-t3-bold text-foreground">
              {decision.title}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {[DECISION_STATUS_LABEL[decision.status], date, chosen && `选了「${chosen.label}」`]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {decision.text ? (
              <Text className="text-sm text-foreground-muted" numberOfLines={4}>
                {decision.text}
              </Text>
            ) : null}
            {decision.status === "proposed" && decision.options?.length ? (
              <View className="flex-row flex-wrap gap-2 pt-1">
                {decision.options.map((option) => (
                  <Button
                    key={option.id}
                    size="compact"
                    label={option.label}
                    loading={pendingId === decision.id}
                    disabled={pendingId !== null}
                    onPress={() => choose(decision, option)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </SettingsSection>
  );
}

function ReviewList(props: {
  readonly target: Target;
  readonly query: EnvironmentQueryView<typeof Telescope.TaskListResult.Type>;
}) {
  const updateTask = useAtomCommand(telescopeBoard.updateTask, { reportFailure: false });
  const [pending, setPending] = useState<{ id: string; status: string } | null>(null);
  const { query } = props;
  if (query.error) return <StatusText tone="danger" text={query.error} />;
  if (!query.data) return <StatusText text="正在读取任务…" />;
  const tasks = reviewQueue(query.data.tasks);
  if (tasks.length === 0) return <StatusText text="没有等你确认的任务。" />;

  const act = (task: Telescope.Task, status: "done" | "in_progress") => {
    setPending({ id: task.id, status });
    void updateTask({
      environmentId: props.target.environmentId,
      input: reviewUpdateInput(task, status),
    }).then((result) => {
      setPending(null);
      reportFailure(result, query.refresh);
    });
  };

  return (
    <SettingsSection title="确认">
      {tasks.map((task, index) => {
        const lastNote = task.freeText.at(-1);
        return (
          <View key={task.id} className={rowClassName(index)}>
            <Text textRole="body" className="font-t3-bold text-foreground">
              {task.title}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {`${TASK_STATUS_LABEL[task.status] ?? task.status} · ${formatBoardDate(task.updatedAt)}`}
            </Text>
            {lastNote ? (
              <Text className="text-sm text-foreground-muted" numberOfLines={3}>
                {lastNote.text}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2 pt-1">
              <Button
                size="compact"
                tone="primary"
                label="确认完成"
                loading={pending?.id === task.id && pending.status === "done"}
                disabled={pending !== null}
                onPress={() => act(task, "done")}
              />
              <Button
                size="compact"
                label="退回"
                loading={pending?.id === task.id && pending.status === "in_progress"}
                disabled={pending !== null}
                onPress={() => act(task, "in_progress")}
              />
            </View>
          </View>
        );
      })}
    </SettingsSection>
  );
}
