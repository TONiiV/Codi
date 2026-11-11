import { useAtomValue } from "@effect/atom-react";
import {
  budgetOf,
  budgetUsageText,
  createTelescopeGovernanceAtoms,
  type GovernanceRow,
  governanceRows,
  killSwitchState,
  parseCallLimit,
} from "@t3tools/client-runtime/telescope/governance";
import * as Routing from "@t3tools/client-runtime/telescope/routing";
import {
  canManageMember,
  failureText,
  hasNoWorkspace,
} from "@t3tools/client-runtime/telescope/workspaces";
import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { PlusIcon, Settings2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { AgentSettingsDialog } from "./MyTeamsAgentDialog";
import { KIND_LABEL, powerSummary, telescopeAgents } from "./myTeamsShared";
import {
  CreateWorkspaceDialog,
  ErrorNote,
  FormDialog,
  JoinWorkspaceDialog,
  TextField,
  useFreshMembers,
  WORKSPACE_ROLE_LABEL,
} from "./TelescopeAccountDialogs";
import { projectRules, ProjectRulesSection } from "./TelescopeProjectRules";
import { ProjectsSection } from "./TelescopeProjectWorkspace";
import {
  noAdminScopeText,
  QueryStatus,
  type RoutingNames,
  type Scoped,
  StatusRow,
  useRoutingNames,
} from "./telescopeSettingsParts";
import { telescope, useTelescopeWorkspaces, WORKSPACE_KIND_LABEL } from "./telescopeState";

const governance = createTelescopeGovernanceAtoms(connectionAtomRuntime, telescope.get);
const routing = Routing.createTelescopeRoutingAtoms(connectionAtomRuntime, telescope.get);
const ALL_PROJECTS = "all";

const isRole = Schema.is(Telescope.WorkspaceRole);
const KILL_SWITCH_LABEL = { running: "运行", paused: "暂停", terminated: "终止" } as const;
const COMPANY_LEVEL_LABEL = { enterprise: "整个公司", personal: "整个工作区" } as const;
const isKillSwitchState = Schema.is(Telescope.KillSwitch.fields.state);
const NO_RULES: ReadonlyArray<Telescope.RoutingRule> = [];

export function MembersSection({ environmentId, workspace, self }: Scoped) {
  const query = useFreshMembers(environmentId, workspace.id);
  const maySetRole = useAtomValue(telescope.setRole.permissionAtom(environmentId));
  const mayRevoke = useAtomValue(telescope.revoke.permissionAtom(environmentId));
  const mayRestore = useAtomValue(telescope.restore.permissionAtom(environmentId));
  const setRole = useAtomCommand(telescope.setRole, "修改角色");
  const revoke = useAtomCommand(telescope.revoke, "移除成员");
  const restore = useAtomCommand(telescope.restore, "恢复成员");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlyArray<string>>([]);
  const [error, setError] = useState<string | null>(null);
  const send = async (
    member: Telescope.Member,
    command: () => Promise<AtomCommandResult<unknown, unknown>>,
  ) => {
    setPending((ids) => [...ids, member.subjectId]);
    const result = await command();
    setPending((ids) => ids.filter((id) => id !== member.subjectId));
    setConfirming(null);
    setError(failureText(result));
  };
  const target = (member: Telescope.Member) => ({
    environmentId,
    input: { workspaceId: workspace.id, subjectId: member.subjectId },
  });
  const members = (query.data?.members ?? []).toSorted(
    (left, right) => Number(left.revokedAt !== undefined) - Number(right.revokedAt !== undefined),
  );
  return (
    <SettingsSection id="telescope-members" title="成员与角色">
      {query.data === null ? <QueryStatus query={query} what="成员" /> : null}
      {members.map((member) => {
        const manageable = canManageMember(self, member);
        const revoked = member.revokedAt !== undefined;
        // Each change re-reads the list; until it lands, a row may offer a change already made.
        const busy = query.isPending || pending.includes(member.subjectId);
        return (
          <SettingsRow
            key={member.subjectId}
            className="wrap-anywhere"
            title={`${member.displayName}${member.subjectId === self.subjectId ? "（你）" : ""}`}
            description={revoked ? "已移除，不能再进入这个工作区。" : undefined}
            control={
              !manageable ? (
                <Badge variant="outline">{WORKSPACE_ROLE_LABEL[member.role]}</Badge>
              ) : revoked ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!mayRestore || busy}
                  onClick={() => send(member, () => restore(target(member)))}
                >
                  恢复
                </Button>
              ) : confirming === member.subjectId ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => send(member, () => revoke(target(member)))}
                  >
                    确认移除
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <div className="w-40">
                    <Select
                      value={member.role}
                      disabled={!maySetRole || busy}
                      onValueChange={async (role) => {
                        if (!isRole(role) || role === member.role) return;
                        const { input, ...rest } = target(member);
                        await send(member, () => setRole({ ...rest, input: { ...input, role } }));
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-full"
                        aria-label={`${member.displayName}的角色`}
                      >
                        <SelectValue>{WORKSPACE_ROLE_LABEL[member.role]}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {Telescope.WorkspaceRole.literals.map((role) => (
                          <SelectItem key={role} value={role}>
                            {WORKSPACE_ROLE_LABEL[role]}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive-outline"
                    disabled={!mayRevoke || busy}
                    onClick={() => setConfirming(member.subjectId)}
                  >
                    移除
                  </Button>
                </>
              )
            }
          />
        );
      })}
      {self.role === "admin" && !(maySetRole && mayRevoke && mayRestore) ? (
        <StatusRow text={noAdminScopeText("成员")} />
      ) : null}
      {error === null ? null : <StatusRow text={error} failed />}
    </SettingsSection>
  );
}

function CompanyAgentsSection({ environmentId, workspace, self }: Scoped) {
  const company = useEnvironmentQuery(
    telescopeAgents.listCompany({ environmentId, input: { workspaceId: workspace.id } }),
  );
  const mayUpdate = useAtomValue(telescopeAgents.updateCompany.permissionAtom(environmentId));
  const mayConfigure = mayUpdate && self.role === "admin";
  const [editing, setEditing] = useState<Telescope.Agent | null>(null);
  const agents = (company.data?.agents ?? []).filter((agent) => agent.ownerSubjectId === null);
  return (
    <SettingsSection id="telescope-agents" title="公司 agents">
      {company.data === null ? <QueryStatus query={company} what="公司 agents" /> : null}
      {agents.map((agent) => (
        <SettingsRow
          key={agent.id}
          className="wrap-anywhere"
          title={agent.name}
          description={`${KIND_LABEL[agent.kind]}，直接做：${powerSummary(agent.standingPowers)}`}
          control={
            mayConfigure ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(agent)}>
                <Settings2Icon /> 设定
              </Button>
            ) : null
          }
        />
      ))}
      {company.data !== null && !mayConfigure ? (
        <StatusRow
          text={
            self.role === "admin"
              ? noAdminScopeText("公司 agents")
              : "只有公司管理员能设定公司 agents。"
          }
        />
      ) : null}
      {editing ? (
        <AgentSettingsDialog
          environmentId={environmentId}
          workspace={workspace}
          self={self}
          agent={editing}
          projects={[]}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </SettingsSection>
  );
}

function CallLimitForm({
  label,
  budget,
  disabled,
  onSave,
}: {
  label: string;
  budget: Telescope.Budget | undefined;
  disabled: boolean;
  onSave: (limit: { readonly limitCalls?: number }) => Promise<void>;
}) {
  const saved = budget?.limitCalls?.toString() ?? "";
  const [text, setText] = useState(saved);
  const parsed = parseCallLimit(text);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (parsed !== null) await onSave(parsed);
      }}
    >
      <div className="w-24">
        <Input
          nativeInput
          size="sm"
          inputMode="numeric"
          placeholder="不限"
          aria-label={`${label}的调用上限`}
          aria-invalid={parsed === null}
          disabled={disabled}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={disabled || parsed === null || text.trim() === saved}
      >
        保存
      </Button>
    </form>
  );
}

function GovernanceSection({ environmentId, workspace, self }: Scoped) {
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const mayRead = useAtomValue(governance.readPermissionAtom(environmentId));
  const admin = self.role === "admin" && mayRead;
  const state = useEnvironmentQuery(admin ? governance.state(scoped) : null);
  const olderServer = state.data !== null && state.data.agents === undefined;
  const mine = useEnvironmentQuery(olderServer ? telescopeAgents.listMine(scoped) : null);
  const company = useEnvironmentQuery(
    olderServer && workspace.kind === "enterprise" ? telescopeAgents.listCompany(scoped) : null,
  );
  const members = useEnvironmentQuery(admin ? telescope.members(scoped) : null);
  const { projects } = useRoutingNames(environmentId, workspace);
  const mayBudget = useAtomValue(governance.setBudget.permissionAtom(environmentId));
  const mayStop = useAtomValue(governance.setKillSwitch.permissionAtom(environmentId));
  const setBudget = useAtomCommand(governance.setBudget, "修改预算");
  const setKillSwitch = useAtomCommand(governance.setKillSwitch, "急停");
  const [error, setError] = useState<string | null>(null);
  if (!admin)
    return (
      <SettingsSection id="telescope-governance" title="预算与急停">
        <StatusRow
          text={
            self.role === "admin"
              ? "这个连接没有 Telescope 管理权限，看不到预算与急停。"
              : "只有管理员能查看和修改预算与急停。"
          }
        />
      </SettingsSection>
    );
  const data = state.data;
  const failedList = [mine, company, members].find(
    (list) => list.data === null && list.error !== null,
  );
  const saveBudget =
    (scope: Telescope.Budget["scope"], scopeId: string) =>
    async (limit: { readonly limitCalls?: number }) => {
      const result = await setBudget({
        environmentId,
        input: { workspaceId: workspace.id, scope, scopeId, ...limit },
      });
      setError(failureText(result));
    };
  const budgetRow = (
    { title, scope, scopeId }: Pick<GovernanceRow, "title" | "scope" | "scopeId">,
    extra?: ReactNode,
  ) => {
    const budget = data === null ? undefined : budgetOf(data, scope, scopeId);
    return (
      <SettingsRow
        key={`${scope}:${scopeId}`}
        className="wrap-anywhere"
        title={title}
        description={budgetUsageText(budget)}
        control={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CallLimitForm
              key={budget?.limitCalls ?? "none"}
              label={title}
              budget={budget}
              disabled={!mayBudget}
              onSave={saveBudget(scope, scopeId)}
            />
            {extra}
          </div>
        }
      />
    );
  };
  return (
    <SettingsSection id="telescope-governance" title="预算与急停">
      <StatusRow text="上限按工具调用次数计，留空表示不限。急停后这个 agent 的下一次工具调用就会被拒绝。" />
      {data === null ? (
        <QueryStatus query={state} what="预算" />
      ) : (
        <>
          {governanceRows(data, {
            company: { id: workspace.id, title: COMPANY_LEVEL_LABEL[workspace.kind] },
            projects,
            members: members.data?.members ?? [],
            self: self.subjectId,
            fallbackAgents: [...(mine.data?.agents ?? []), ...(company.data?.agents ?? [])],
          }).map((row) =>
            budgetRow(
              row,
              row.scope !== "agent" ? undefined : (
                <ToggleGroup
                  aria-label={`${row.title}的急停`}
                  disabled={!mayStop}
                  value={[killSwitchState(data, row.scopeId)]}
                  onValueChange={async (next) => {
                    const value = next[0];
                    if (!isKillSwitchState(value)) return;
                    const result = await setKillSwitch({
                      environmentId,
                      input: { workspaceId: workspace.id, agentId: row.scopeId, state: value },
                    });
                    setError(failureText(result));
                  }}
                >
                  {Telescope.KillSwitch.fields.state.literals.map((value) => (
                    <Toggle key={value} value={value}>
                      {KILL_SWITCH_LABEL[value]}
                    </Toggle>
                  ))}
                </ToggleGroup>
              ),
            ),
          )}
          {failedList === undefined ? null : (
            <QueryStatus query={failedList} what={failedList === members ? "成员" : "agent 列表"} />
          )}
        </>
      )}
      {error === null ? null : <StatusRow text={error} failed />}
    </SettingsSection>
  );
}

function Picker<T extends string>(props: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const selected = props.options.find((entry) => entry.value === props.value);
  return (
    <Label className="flex min-w-40 flex-1 flex-col items-stretch">
      {props.label}
      <Select
        value={props.value}
        onValueChange={(next) => {
          const option = props.options.find((entry) => entry.value === next);
          if (option) props.onChange(option.value);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{selected?.label ?? "无可选项"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {props.options.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Label>
  );
}

function RoutingRuleDialog(
  props: Scoped & { names: RoutingNames; rule: Telescope.RoutingRule | null; onClose: () => void },
) {
  const { rule, names } = props;
  const [draft, setDraft] = useState<Routing.RoutingRuleDraft>({
    projectId: rule?.projectId ?? null,
    taskType: rule === null || rule.taskType === Telescope.ANY_TASK_TYPE ? "" : rule.taskType,
    harness: rule?.harness ?? names.harnesses[0]?.value ?? null,
    model: rule?.model ?? "",
    priority: String(rule?.priority ?? 0),
  });
  const [touched, setTouched] = useState(rule !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = useAtomCommand(routing.set, "保存路由规则");
  const unbound = names.unbound(draft.projectId ?? undefined);
  const parsed = unbound
    ? { problem: "这个目录已移出工作区，请换一个项目。" }
    : Routing.parseRoutingRuleDraft(draft);
  const update = (fields: Partial<Routing.RoutingRuleDraft>) => {
    setDraft({ ...draft, ...fields });
    setTouched(true);
  };
  const projects =
    rule?.projectId !== undefined && names.unbound(rule.projectId)
      ? [...names.projects, { value: rule.projectId, label: names.project(rule.projectId) }]
      : names.projects;
  // A rule may name a harness this server does not run; editing it must not drop that harness.
  const harnesses =
    rule === null || names.harnesses.some((entry) => entry.value === rule.harness)
      ? names.harnesses
      : [...names.harnesses, { value: rule.harness, label: `${rule.harness}（这台服务器没有）` }];
  return (
    <FormDialog
      title={rule === null ? "添加路由规则" : "修改路由规则"}
      description="授权单不允许，或这台服务器没有为项目启用这个 harness 时，跳到下一条规则。"
      submitLabel={rule === null ? "添加" : "保存"}
      canSubmit={!busy && "fields" in parsed}
      error={error ?? (touched && "problem" in parsed ? parsed.problem : null)}
      onClose={props.onClose}
      onSubmit={async () => {
        if (!("fields" in parsed)) return;
        setBusy(true);
        setError(null);
        const id = rule === null ? {} : { id: rule.id };
        const result = await set({
          environmentId: props.environmentId,
          input: { workspaceId: props.workspace.id, ...parsed.fields, ...id },
        });
        setBusy(false);
        if (result._tag === "Success") props.onClose();
        else setError(failureText(result, Routing.ROUTING_ERROR_TEXT));
      }}
    >
      <Picker
        label="项目"
        value={draft.projectId ?? ALL_PROJECTS}
        options={[{ value: ALL_PROJECTS, label: "全部项目" }, ...projects]}
        onChange={(value) => update({ projectId: value === ALL_PROJECTS ? null : value })}
      />
      <TextField
        label="任务类型（留空表示任意类型）"
        placeholder="例如 review"
        value={draft.taskType}
        onChange={(taskType) => update({ taskType })}
      />
      <Picker
        label="Harness"
        value={draft.harness}
        options={harnesses}
        onChange={(harness) => update({ harness })}
      />
      <TextField
        label="模型"
        placeholder="例如 gpt-5.4-mini"
        value={draft.model}
        onChange={(model) => update({ model })}
      />
      <TextField
        label="优先级（同组里数字大的先用）"
        value={draft.priority}
        onChange={(priority) => update({ priority })}
      />
    </FormDialog>
  );
}

function RoutingPreview(
  props: Scoped & { names: RoutingNames; rules: ReadonlyArray<Telescope.RoutingRule> },
) {
  const scoped = { environmentId: props.environmentId, input: { workspaceId: props.workspace.id } };
  const mine = useEnvironmentQuery(telescopeAgents.listMine(scoped));
  const company = useEnvironmentQuery(
    props.workspace.kind === "enterprise" ? telescopeAgents.listCompany(scoped) : null,
  );
  const agents = [...(mine.data?.agents ?? []), ...(company.data?.agents ?? [])]
    .filter((agent, index, all) => all.findIndex((other) => other.id === agent.id) === index)
    .map((agent) => ({ value: agent.id, label: agent.name }));
  const resolve = useAtomCommand(routing.resolve, "试一下路由");
  const [agentId, setAgentId] = useState<Telescope.AgentId | null>(null);
  const [taskType, setTaskType] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<{
    asked: Parameters<typeof Routing.answersPreview>[0];
    outcome: Telescope.RoutingResolution | string | null;
  } | null>(null);
  const chosen = agents.find((agent) => agent.value === agentId)?.value ?? agents[0]?.value;
  const outcome =
    answer !== null &&
    Routing.answersPreview(answer.asked, { agentId: chosen, taskType, rules: props.rules })
      ? answer.outcome
      : null;
  const candidate = (ruleId: Telescope.RoutingRuleId | undefined) => {
    const rule = props.rules.find((entry) => entry.id === ruleId);
    if (ruleId === undefined) return "agent 自己的模型";
    return rule === undefined ? "一条刚改过的规则（刷新后可见）" : props.names.rule(rule);
  };
  return (
    <SettingsRow
      title="试一下"
      description="选一个 agent 和任务类型，看这类任务交给哪个 harness 和模型。"
    >
      <form
        className="flex flex-wrap items-end gap-2 pt-2 pb-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || chosen === undefined || Routing.taskTypeProblem(taskType) !== null) return;
          const asked = { agentId: chosen, taskType, rules: props.rules };
          setPending(true);
          const result = await resolve({
            environmentId: props.environmentId,
            input: { workspaceId: props.workspace.id, agentId: chosen, taskType: taskType.trim() },
          });
          setPending(false);
          setAnswer({
            asked,
            outcome:
              result._tag === "Success"
                ? result.value
                : failureText(result, Routing.ROUTING_ERROR_TEXT),
          });
        }}
      >
        <Picker label="Agent" value={chosen ?? null} options={agents} onChange={setAgentId} />
        <div className="min-w-40 flex-1">
          <TextField
            label="任务类型"
            placeholder="例如 review"
            value={taskType}
            onChange={setTaskType}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={pending || chosen === undefined || Routing.taskTypeProblem(taskType) !== null}
        >
          {pending ? "正在试…" : "试一下"}
        </Button>
      </form>
      {typeof outcome === "string" ? <ErrorNote text={outcome} /> : null}
      {outcome !== null && typeof outcome !== "string" ? (
        <div className="flex flex-col gap-1 pb-3 text-xs text-muted-foreground wrap-anywhere">
          <p className="text-sm text-foreground">
            {outcome.modelSelection === undefined
              ? "不会交给任何 harness"
              : `${props.names.harness(outcome.modelSelection.instanceId)} · ${outcome.modelSelection.model}`}
          </p>
          <p>
            {Routing.ROUTING_SOURCE_TEXT[outcome.source]}
            {outcome.source === "rule" ? `：${candidate(outcome.ruleId)}` : ""}
          </p>
          {outcome.skipped.map((skip) => (
            <p key={skip.ruleId ?? "agent"}>
              跳过 {candidate(skip.ruleId)}：{Routing.ROUTING_SKIP_REASON_TEXT[skip.reason]}
            </p>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}

function RoutingSection(props: Scoped) {
  const { environmentId, workspace, self } = props;
  const query = useEnvironmentQuery(
    routing.list({ environmentId, input: { workspaceId: workspace.id } }),
  );
  const isAdmin = self.role === "admin";
  const maySet = useAtomValue(routing.set.permissionAtom(environmentId));
  const mayEdit = useAtomValue(routing.remove.permissionAtom(environmentId)) && maySet && isAdmin;
  const names = useRoutingNames(environmentId, workspace);
  const remove = useAtomCommand(routing.remove, "删除路由规则");
  const [editing, setEditing] = useState<Telescope.RoutingRule | "new" | null>(null);
  const [confirming, setConfirming] = useState<Telescope.RoutingRuleId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rules = query.data?.rules ?? NO_RULES;
  const confirmDelete = async (id: Telescope.RoutingRuleId) => {
    setBusy(true);
    const result = await remove({ environmentId, input: { workspaceId: workspace.id, id } });
    setBusy(false);
    setConfirming(null);
    setError(failureText(result, Routing.ROUTING_ERROR_TEXT));
  };
  return (
    <SettingsSection
      id="telescope-routing"
      title="路由规则"
      headerAction={
        mayEdit ? (
          <Button size="xs" variant="outline" onClick={() => setEditing("new")}>
            <PlusIcon /> 添加规则
          </Button>
        ) : null
      }
    >
      <StatusRow text="一类任务交给哪个 harness 和模型。按下面的分组从上往下找，同组里优先级高的先，同优先级先建的先；都不适用时用 agent 自己的模型。" />
      {query.data === null ? <QueryStatus query={query} what="路由规则" /> : null}
      {query.data !== null && rules.length === 0 ? (
        <StatusRow text="还没有路由规则，任务都用 agent 自己的模型。" />
      ) : null}
      {Routing.groupRoutingRules(rules).map(({ label, rules: grouped }) => [
        <div
          key={label}
          className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground sm:px-4"
        >
          {label}
        </div>,
        ...grouped.map((rule) => (
          <SettingsRow
            key={rule.id}
            className="wrap-anywhere"
            title={`${names.project(rule.projectId)} · ${Routing.taskTypeLabel(rule.taskType)}`}
            description={`${names.harness(rule.harness)} · ${rule.model} · 优先级 ${rule.priority}`}
            control={
              confirming === rule.id && mayEdit ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => confirmDelete(rule.id)}
                  >
                    确认删除
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                  >
                    取消
                  </Button>
                </>
              ) : mayEdit ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(rule)}>
                    修改
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive-outline"
                    onClick={() => setConfirming(rule.id)}
                  >
                    删除
                  </Button>
                </>
              ) : null
            }
          />
        )),
      ])}
      {query.data !== null && !mayEdit ? (
        <StatusRow
          text={isAdmin ? noAdminScopeText("路由规则") : "只有管理员能添加、修改和删除路由规则。"}
        />
      ) : null}
      {error === null ? null : <StatusRow text={error} failed />}
      <RoutingPreview {...props} names={names} rules={rules} />
      {editing === null ? null : (
        <RoutingRuleDialog
          {...props}
          names={names}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsSection>
  );
}

const settled = (query: EnvironmentQueryView<unknown>) =>
  query.data !== null || query.error !== null;

function WorkspaceSettings(props: Scoped) {
  const { environmentId, workspace, self } = props;
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const mayReadGovernance =
    useAtomValue(governance.readPermissionAtom(environmentId)) && self.role === "admin";
  const company = workspace.kind === "enterprise";
  const lists = [
    useEnvironmentQuery(telescope.members(scoped)),
    useEnvironmentQuery(telescope.projects(scoped)),
    useEnvironmentQuery(routing.list(scoped)),
    useEnvironmentQuery(projectRules.list(scoped)),
  ];
  const budgets = useEnvironmentQuery(mayReadGovernance ? governance.state(scoped) : null);
  const agents = useEnvironmentQuery(company ? telescopeAgents.listCompany(scoped) : null);
  // A search target scrolls into view once the sections above it have their rows.
  const ready =
    lists.every(settled) &&
    (!mayReadGovernance || settled(budgets)) &&
    (!company || settled(agents));
  return (
    <SettingsPageContainer searchTargetReady={ready}>
      <SettingsSection title="当前工作区">
        <SettingsRow
          className="wrap-anywhere"
          title={workspace.name}
          description="这一页的修改都作用于这个工作区，可在 Telescope 侧栏底部的账号菜单里切换。"
          control={<Badge variant="outline">{WORKSPACE_KIND_LABEL[workspace.kind]}</Badge>}
        />
      </SettingsSection>
      <MembersSection {...props} />
      <ProjectsSection {...props} />
      {company ? <CompanyAgentsSection {...props} /> : null}
      <GovernanceSection {...props} />
      <RoutingSection {...props} />
      <ProjectRulesSection {...props} />
    </SettingsPageContainer>
  );
}

function NoWorkspaceRow({ environmentId }: { environmentId: EnvironmentId | null }) {
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const close = () => setDialog(null);
  return (
    <SettingsRow
      title="还没有工作区"
      description="新建或加入一个工作区后，可以在这里管理成员、agents、预算和急停。"
      control={
        environmentId === null ? null : (
          <>
            <Button size="sm" variant="outline" onClick={() => setDialog("join")}>
              加入工作区
            </Button>
            <Button size="sm" onClick={() => setDialog("create")}>
              <PlusIcon /> 新建工作区
            </Button>
            {dialog === "create" ? (
              <CreateWorkspaceDialog environmentId={environmentId} defaultName="" onClose={close} />
            ) : dialog === "join" ? (
              <JoinWorkspaceDialog environmentId={environmentId} defaultName="" onClose={close} />
            ) : null}
          </>
        )
      }
    />
  );
}

/** Telescope's server settings for the current workspace; the server checks every change. */
export function TelescopeSettingsPanel() {
  const { environmentId, current } = useTelescopeWorkspaces();
  const list = useEnvironmentQuery(
    environmentId === null ? null : telescope.list({ environmentId, input: {} }),
  );
  const detail = useEnvironmentQuery(
    environmentId === null || current === null
      ? null
      : telescope.get({ environmentId, input: { workspaceId: current.id } }),
  );
  const empty = hasNoWorkspace(environmentId, list.data);
  if (environmentId !== null && detail.data !== null)
    return <WorkspaceSettings environmentId={environmentId} {...detail.data} />;
  return (
    <SettingsPageContainer searchTargetReady={empty}>
      <SettingsSection id="telescope-members" title="成员与角色">
        {empty ? (
          <NoWorkspaceRow environmentId={environmentId} />
        ) : (
          <QueryStatus query={list.error !== null ? list : detail} what="工作区" />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
