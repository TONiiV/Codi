import { cappedPowers, ownerCanMergePRs } from "@t3tools/client-runtime/telescope/agents";
import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { LockIcon, UsersRoundIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useEnvironmentQuery, type EnvironmentQueryView } from "../../state/query";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { EXPOSURE_LABEL, KIND_LABEL, powerSummary, telescopeAgents } from "./myTeamsShared";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";

type Tab = "mine" | "company" | "skills";

// Placeholder until Telescope has a skills API; shown read-only.
const EXAMPLE_SKILLS = [
  { id: "pr-review", name: "PR 评审清单", summary: "合并前查测试、迁移、权限和文档。" },
  { id: "release", name: "发版流程", summary: "打 tag、写更新日志、通知相关人。" },
  { id: "weekly", name: "周报格式", summary: "从任务板汇总本周完成和卡住的事。" },
];

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

const READ_ERROR_TEXT: Record<Telescope.WorkspaceError["reason"], string> = {
  not_found: "找不到这个工作区，请刷新后再试。",
  forbidden: "你没有权限查看这些内容。",
  expired: "已经过期，请刷新后再试。",
  conflict: "和当前状态冲突，请刷新后再试。",
  storage: "服务器读取出错，请稍后再试。",
};

function QueryState<A>({
  query,
  children,
}: {
  query: EnvironmentQueryView<A>;
  children: (data: A) => ReactNode;
}) {
  if (query.data !== null) return children(query.data);
  if (query.error !== null)
    return (
      <Alert variant="error">
        <AlertDescription>
          读取失败：
          {isWorkspaceError(query.failure)
            ? READ_ERROR_TEXT[query.failure.reason]
            : "请检查连接后再试。"}
        </AlertDescription>
        <AlertAction>
          <Button size="xs" variant="outline" onClick={query.refresh}>
            重试
          </Button>
        </AlertAction>
      </Alert>
    );
  return (
    <div className="flex justify-center py-10">
      <Spinner size="lg" tone="muted" />
    </div>
  );
}

function AgentRow({ agent, powers }: { agent: Telescope.Agent; powers: Telescope.StandingPowers }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{agent.name}</span>
          {agent.name === KIND_LABEL[agent.kind] ? null : (
            <span className="text-xs text-muted-foreground">{KIND_LABEL[agent.kind]}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {agent.ownerSubjectId === null ? null : (
            <Badge variant={agent.exposure === "hidden" ? "outline" : "info"}>
              {EXPOSURE_LABEL[agent.exposure]}
            </Badge>
          )}
          <Badge variant="outline">直接做：{powerSummary(powers)}</Badge>
          <Badge variant={agent.syncWithBoard ? "info" : "outline"}>
            {agent.syncWithBoard ? "任务板同步" : "不同步任务板"}
          </Badge>
        </div>
      </div>
    </li>
  );
}

function AgentList({ children }: { children: ReactNode }) {
  return <ul className="divide-y rounded-lg border bg-card">{children}</ul>;
}

function Teams({
  environmentId,
  workspace,
  self,
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  self: Telescope.Member;
}) {
  const enterprise = workspace.kind === "enterprise";
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const [picked, setPicked] = useState<Tab>("mine");
  const tab = picked === "company" && !enterprise ? "mine" : picked;
  const bindings = useEnvironmentQuery(telescopeAgents.bindings(scoped));
  const mine = useEnvironmentQuery(telescopeAgents.listMine(scoped));
  const company = useEnvironmentQuery(enterprise ? telescopeAgents.listCompany(scoped) : null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {enterprise
            ? "配你自己的 agent 队伍，看公司有哪些 agent 能找。"
            : "配你自己的 agent 队伍。个人工作区没有公司 agents。"}
        </p>
        <ToggleGroup
          aria-label="My Teams 分区"
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "mine" || value === "company" || value === "skills") setPicked(value);
          }}
        >
          <Toggle value="mine">我的 agents</Toggle>
          {enterprise ? <Toggle value="company">公司 agents</Toggle> : null}
          <Toggle value="skills">Skills</Toggle>
        </ToggleGroup>
      </div>

      {tab === "mine" ? (
        <section className="flex flex-col gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">
            这些 agent 归你：最上面是首席幕僚，然后是你在每个项目里的首席代理，以及你自己建的自定义
            agent。改名和设定只有你能做。
          </p>
          <QueryState query={mine}>
            {({ agents }) =>
              agents.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有 agent。</p>
              ) : (
                <QueryState query={bindings}>
                  {(projects) => (
                    <AgentList>
                      {agents.map((agent) => (
                        <AgentRow
                          key={agent.id}
                          agent={agent}
                          powers={cappedPowers(
                            agent.standingPowers,
                            ownerCanMergePRs(self, agent, projects.bindings),
                          )}
                        />
                      ))}
                    </AgentList>
                  )}
                </QueryState>
              )
            }
          </QueryState>
        </section>
      ) : null}

      {tab === "company" ? (
        <section className="flex flex-col gap-3">
          <Alert>
            <LockIcon />
            <AlertDescription>
              公司 agents 和你的 agents 是两套。公司 agents 归公司，按你的权限回答。
              {self.role === "admin"
                ? "你是公司管理员，可以设定它们。"
                : "只有公司管理员能配置它们。"}
            </AlertDescription>
          </Alert>
          <QueryState query={company}>
            {({ agents }) => {
              const own = agents.filter((agent) => agent.ownerSubjectId === null);
              return own.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有公司 agents。</p>
              ) : (
                <AgentList>
                  {own.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} powers={agent.standingPowers} />
                  ))}
                </AgentList>
              );
            }}
          </QueryState>
        </section>
      ) : null}

      {tab === "skills" ? (
        <section className="flex flex-col gap-3">
          <Alert variant="info">
            <AlertDescription>
              Skills 即将推出：Skill 是 agent 做某件事的方法，到时可以决定你的哪个 agent
              用它。下面是示例，现在还不能选用。
            </AlertDescription>
          </Alert>
          <AgentList>
            {EXAMPLE_SKILLS.map((skill) => (
              <li key={skill.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{skill.name}</span>
                  <Badge variant="outline">示例</Badge>
                </div>
                <span className="text-sm text-muted-foreground">{skill.summary}</span>
              </li>
            ))}
          </AgentList>
        </section>
      ) : null}
    </div>
  );
}

/** The My Teams view: the caller's agents, the company's agents and skills in the current workspace. */
export function MyTeamsPage() {
  const { environmentId, current } = useTelescopeWorkspaces();
  const list = useEnvironmentQuery(
    environmentId === null ? null : telescope.list({ environmentId, input: {} }),
  );
  const detail = useEnvironmentQuery(
    environmentId === null || current === null
      ? null
      : telescope.get({ environmentId, input: { workspaceId: current.id } }),
  );
  if (environmentId === null || current === null)
    return environmentId !== null && list.data === null ? (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <QueryState query={list}>{() => null}</QueryState>
      </div>
    ) : (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersRoundIcon />
          </EmptyMedia>
          <EmptyTitle>还没有工作区</EmptyTitle>
          <EmptyDescription>建好或加入一个工作区后，你的 agents 会列在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <QueryState query={detail}>
        {({ workspace, self }) => (
          <Teams environmentId={environmentId} workspace={workspace} self={self} />
        )}
      </QueryState>
    </div>
  );
}
