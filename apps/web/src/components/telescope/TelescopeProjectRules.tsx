import { useAtomValue } from "@effect/atom-react";
import * as ProjectRules from "@t3tools/client-runtime/telescope/projectRules";
import { failureText } from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { POWERS, powerSummary } from "./myTeamsShared";
import { FormDialog } from "./TelescopeAccountDialogs";
import {
  QueryStatus,
  type RoutingNames,
  type Scoped,
  StatusRow,
  useRoutingNames,
} from "./TelescopeSettings";

const projectRules = ProjectRules.createTelescopeProjectRuleAtoms(connectionAtomRuntime);

function CheckRow(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm wrap-anywhere">
      <Checkbox checked={props.checked} onCheckedChange={(on) => props.onChange(on === true)} />
      <span className="flex min-w-0 flex-col">
        <span>{props.label}</span>
        {props.hint ? <span className="text-xs text-muted-foreground">{props.hint}</span> : null}
      </span>
    </label>
  );
}

function Group(props: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{props.legend}</legend>
      {props.children}
    </fieldset>
  );
}

function ProjectRuleDialog(
  props: Scoped & { names: RoutingNames; rule: Telescope.ProjectRule; onClose: () => void },
) {
  const { rule, names } = props;
  const [draft, setDraft] = useState(() => ProjectRules.projectRuleDraft(rule));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = useAtomCommand(projectRules.set, "保存项目规则");
  const parsed = ProjectRules.parseProjectRuleDraft(draft);
  const update = (fields: Partial<ProjectRules.ProjectRuleDraft>) => {
    setDraft({ ...draft, ...fields });
    setTouched(true);
  };
  // A stored harness this server does not run must survive an edit.
  const harnesses = [
    ...names.harnesses,
    ...(rule.routing?.harnesses ?? [])
      .filter((id) => !names.harnesses.some((entry) => entry.value === id))
      .map((id) => ({ value: id, label: `${id}（这台服务器没有）` })),
  ];
  const chosen = draft.harnesses ?? [];
  return (
    <FormDialog
      title={`修改项目规则：${names.project(rule.projectId)}`}
      description="规则只能收回 agent 角色本来有的权限。允许的 harness 和模型限制路由能为这个项目选什么。"
      submitLabel="保存"
      canSubmit={!busy && "fields" in parsed}
      error={error ?? (touched && "problem" in parsed ? parsed.problem : null)}
      onClose={props.onClose}
      onSubmit={async () => {
        if (!("fields" in parsed)) return;
        setBusy(true);
        setError(null);
        const result = await set({
          environmentId: props.environmentId,
          input: { workspaceId: props.workspace.id, projectId: rule.projectId, ...parsed.fields },
        });
        setBusy(false);
        if (result._tag === "Success") props.onClose();
        else setError(failureText(result, ProjectRules.PROJECT_RULE_ERROR_TEXT));
      }}
    >
      <Group legend="这个项目里 agent 能直接做的事">
        {POWERS.map((power) => (
          <CheckRow
            key={power.id}
            label={power.label}
            hint={power.hint}
            checked={draft.powers[power.id]}
            onChange={(on) => update({ powers: { ...draft.powers, [power.id]: on } })}
          />
        ))}
      </Group>
      <Group legend="允许的 harness">
        <CheckRow
          label="不限"
          checked={draft.harnesses === null}
          onChange={(on) => update({ harnesses: on ? null : [] })}
        />
        {draft.harnesses === null
          ? null
          : harnesses.map((entry) => (
              <CheckRow
                key={entry.value}
                label={entry.label}
                checked={chosen.includes(entry.value)}
                onChange={(on) =>
                  update({
                    harnesses: on
                      ? [...chosen, entry.value]
                      : chosen.filter((id) => id !== entry.value),
                  })
                }
              />
            ))}
      </Group>
      <Group legend="允许的模型">
        <CheckRow
          label="不限"
          checked={draft.models === null}
          onChange={(on) => update({ models: on ? null : "" })}
        />
        {draft.models === null ? null : (
          <Label className="flex flex-col items-stretch">
            模型（每行一个，或用逗号分隔）
            <Textarea
              rows={4}
              placeholder="例如 gpt-5.4-mini"
              value={draft.models}
              onChange={(event) => update({ models: event.currentTarget.value })}
            />
          </Label>
        )}
      </Group>
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => update(ProjectRules.DEFAULT_PROJECT_RULE_DRAFT)}
        >
          恢复默认
        </Button>
      </div>
    </FormDialog>
  );
}

export function ProjectRulesSection(props: Scoped) {
  const { environmentId, workspace, self } = props;
  const query = useEnvironmentQuery(
    projectRules.list({ environmentId, input: { workspaceId: workspace.id } }),
  );
  const isAdmin = self.role === "admin";
  const mayEdit = useAtomValue(projectRules.set.permissionAtom(environmentId)) && isAdmin;
  const names = useRoutingNames(environmentId, workspace);
  const [editing, setEditing] = useState<Telescope.ProjectRule | null>(null);
  const rules = query.data?.rules ?? [];
  return (
    <SettingsSection id="telescope-project-rules" title="项目规则">
      <StatusRow text="项目规则只能收回 agent 角色本来有的权限，不能多给；允许的 harness 和模型限制路由能为这个项目的 agents 选什么。" />
      {query.data === null ? <QueryStatus query={query} what="项目规则" /> : null}
      {query.data !== null && rules.length === 0 ? (
        <StatusRow text="这个工作区还没有绑定项目。" />
      ) : null}
      {rules.map((rule) => (
        <SettingsRow
          key={rule.projectId}
          className="wrap-anywhere"
          title={names.project(rule.projectId)}
          description={`直接做：${powerSummary(rule.powers)} · 允许：${ProjectRules.allowlistSummary(rule.routing, names.harness)}`}
          control={
            <>
              {ProjectRules.isDefaultProjectRule(rule) ? (
                <Badge variant="outline">默认</Badge>
              ) : null}
              {mayEdit ? (
                <Button size="sm" variant="outline" onClick={() => setEditing(rule)}>
                  修改
                </Button>
              ) : null}
            </>
          }
        />
      ))}
      {query.data !== null && !mayEdit ? (
        <StatusRow
          text={
            isAdmin
              ? "这个连接没有 Telescope 管理权限，只能查看项目规则。"
              : "只有管理员能修改项目规则。"
          }
        />
      ) : null}
      {editing === null ? null : (
        <ProjectRuleDialog
          {...props}
          names={names}
          rule={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsSection>
  );
}
