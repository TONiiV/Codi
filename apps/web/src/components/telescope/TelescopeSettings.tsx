import { useAtomValue } from "@effect/atom-react";
import {
  budgetOf,
  budgetUsageText,
  createTelescopeGovernanceAtoms,
  killSwitchState,
  parseCallLimit,
} from "@t3tools/client-runtime/telescope/governance";
import { canManageMember, failureText } from "@t3tools/client-runtime/telescope/workspaces";
import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { Settings2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { AgentSettingsDialog } from "./MyTeamsAgentDialog";
import { KIND_LABEL, powerSummary, telescopeAgents } from "./myTeamsShared";
import { ErrorNote, useFreshMembers, WORKSPACE_ROLE_LABEL } from "./TelescopeAccountDialogs";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";

const governance = createTelescopeGovernanceAtoms(connectionAtomRuntime);

const isRole = Schema.is(Telescope.WorkspaceRole);
const KILL_SWITCH_LABEL = { running: "运行", paused: "暂停", terminated: "终止" } as const;
const isKillSwitchState = Schema.is(Telescope.KillSwitch.fields.state);

interface Scoped {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  self: Telescope.Member;
}

function StatusRow(props: { text: string; failed?: boolean; onRetry?: () => void }) {
  return (
    <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
      {props.failed ? <ErrorNote {...props} /> : props.text}
    </div>
  );
}

/** Loading or failed state of a query whose data is still missing. */
function QueryStatus({ query, what }: { query: EnvironmentQueryView<unknown>; what: string }) {
  const failed = query.error !== null;
  return (
    <StatusRow
      text={failed ? `${what}加载失败。` : `正在加载${what}…`}
      failed={failed}
      onRetry={query.refresh}
    />
  );
}

function MembersSection({ environmentId, workspace, self }: Scoped) {
  const query = useFreshMembers(environmentId, workspace.id);
  const maySetRole = useAtomValue(telescope.setRole.permissionAtom(environmentId));
  const mayRevoke = useAtomValue(telescope.revoke.permissionAtom(environmentId));
  const mayRestore = useAtomValue(telescope.restore.permissionAtom(environmentId));
  const setRole = useAtomCommand(telescope.setRole, "修改角色");
  const revoke = useAtomCommand(telescope.revoke, "移除成员");
  const restore = useAtomCommand(telescope.restore, "恢复成员");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settle = (result: AtomCommandResult<unknown, unknown>) => {
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
        return (
          <SettingsRow
            key={member.subjectId}
            title={`${member.displayName}${member.subjectId === self.subjectId ? "（你）" : ""}`}
            description={revoked ? "已移除，不能再进入这个工作区。" : undefined}
            control={
              !manageable ? (
                <Badge variant="outline">{WORKSPACE_ROLE_LABEL[member.role]}</Badge>
              ) : revoked ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!mayRestore}
                  onClick={async () => settle(await restore(target(member)))}
                >
                  恢复
                </Button>
              ) : confirming === member.subjectId ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => settle(await revoke(target(member)))}
                  >
                    确认移除
                  </Button>
                  <Button size="sm" variant="ghost-muted" onClick={() => setConfirming(null)}>
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <div className="w-36">
                    <Select
                      value={member.role}
                      disabled={!maySetRole}
                      onValueChange={async (role) => {
                        if (!isRole(role) || role === member.role) return;
                        const { input, ...rest } = target(member);
                        settle(await setRole({ ...rest, input: { ...input, role } }));
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
                    disabled={!mayRevoke}
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
      {error === null ? null : <StatusRow text={error} failed />}
    </SettingsSection>
  );
}

function CompanyAgentsSection({ environmentId, workspace, self }: Scoped) {
  const company = useEnvironmentQuery(
    telescopeAgents.listCompany({ environmentId, input: { workspaceId: workspace.id } }),
  );
  const mayConfigure =
    useAtomValue(telescopeAgents.updateCompany.permissionAtom(environmentId)) &&
    self.role === "admin";
  const [editing, setEditing] = useState<Telescope.Agent | null>(null);
  const agents = (company.data?.agents ?? []).filter((agent) => agent.ownerSubjectId === null);
  return (
    <SettingsSection id="telescope-agents" title="公司 agents">
      {company.data === null ? <QueryStatus query={company} what="公司 agents" /> : null}
      {agents.map((agent) => (
        <SettingsRow
          key={agent.id}
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
        <StatusRow text="只有公司管理员能设定公司 agents。" />
      ) : null}
      {editing ? (
        <AgentSettingsDialog
          environmentId={environmentId}
          workspace={workspace}
          self={self}
          agent={editing}
          bindings={[]}
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
  const mine = useEnvironmentQuery(admin ? telescopeAgents.listMine(scoped) : null);
  const company = useEnvironmentQuery(
    admin && workspace.kind === "enterprise" ? telescopeAgents.listCompany(scoped) : null,
  );
  const mayBudget = useAtomValue(governance.setBudget.permissionAtom(environmentId));
  const mayStop = useAtomValue(governance.setKillSwitch.permissionAtom(environmentId));
  const setBudget = useAtomCommand(governance.setBudget, "修改预算");
  const setKillSwitch = useAtomCommand(governance.setKillSwitch, "急停");
  const [error, setError] = useState<string | null>(null);
  if (!admin)
    return (
      <SettingsSection id="telescope-governance" title="预算与急停">
        <StatusRow text="只有管理员能查看和修改预算与急停。" />
      </SettingsSection>
    );
  const data = state.data;
  const agents = [...(mine.data?.agents ?? []), ...(company.data?.agents ?? [])].filter(
    (agent, index, all) => all.findIndex((other) => other.id === agent.id) === index,
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
    title: string,
    scope: Telescope.Budget["scope"],
    scopeId: string,
    extra?: ReactNode,
  ) => {
    const budget = data === null ? undefined : budgetOf(data, scope, scopeId);
    return (
      <SettingsRow
        key={scopeId}
        title={title}
        description={budgetUsageText(budget)}
        control={
          <>
            <CallLimitForm
              key={budget?.limitCalls ?? "none"}
              label={title}
              budget={budget}
              disabled={!mayBudget}
              onSave={saveBudget(scope, scopeId)}
            />
            {extra}
          </>
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
          {budgetRow("整个公司", "company", workspace.id)}
          {agents.map((agent) =>
            budgetRow(
              agent.name,
              "agent",
              agent.id,
              <ToggleGroup
                aria-label={`${agent.name}的急停`}
                disabled={!mayStop}
                value={[killSwitchState(data, agent.id)]}
                onValueChange={async (next) => {
                  const value = next[0];
                  if (!isKillSwitchState(value)) return;
                  const result = await setKillSwitch({
                    environmentId,
                    input: { workspaceId: workspace.id, agentId: agent.id, state: value },
                  });
                  setError(failureText(result));
                }}
              >
                {Telescope.KillSwitch.fields.state.literals.map((value) => (
                  <Toggle key={value} value={value}>
                    {KILL_SWITCH_LABEL[value]}
                  </Toggle>
                ))}
              </ToggleGroup>,
            ),
          )}
        </>
      )}
      {error === null ? null : <StatusRow text={error} failed />}
    </SettingsSection>
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
  const loaded = detail.data;
  return (
    <SettingsPageContainer>
      {environmentId !== null && loaded !== null ? (
        <>
          <MembersSection environmentId={environmentId} {...loaded} />
          {loaded.workspace.kind === "enterprise" ? (
            <CompanyAgentsSection environmentId={environmentId} {...loaded} />
          ) : null}
          <GovernanceSection environmentId={environmentId} {...loaded} />
        </>
      ) : (
        <SettingsSection id="telescope-members" title="成员与角色">
          {list.data !== null && current === null ? (
            <StatusRow text="还没有工作区。在 Telescope 里新建或加入一个工作区后，可以在这里管理成员、agents、预算和急停。" />
          ) : (
            <QueryStatus query={list.error !== null ? list : detail} what="工作区" />
          )}
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}
