import { hasNoWorkspace } from "@t3tools/client-runtime/telescope/workspaces";
import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useState, type ReactNode } from "react";

import { readLocalStorageValue, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../../state/query";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { telescopeAgents } from "./myTeamsShared";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";
import { telescopeSearch, useChatAgentId, useTasksLayout } from "./telescopeViews";

const ChatGroupId = Schema.Literals(["mine", "company"]);
type ChatGroupId = typeof ChatGroupId.Type;

const FOLDED_KEY = "t3code:telescope:folded-chat-groups:v1";
const FoldedGroups = Schema.Array(ChatGroupId);
const NONE_FOLDED: ReadonlyArray<ChatGroupId> = [];

const ROLE_LABEL: Record<Telescope.AgentKind, string> = {
  chief_of_staff: "个人助理",
  chief_agent: "Chief Agent",
  custom: "自定义 agent",
  company_main: "主代理",
  department: "职能代理",
};

/** Chief Agents are named "<project> Chief Agent"; only the project part tells them apart. */
function initials(agent: Telescope.Agent): string {
  const own = agent.kind === "chief_agent" ? agent.name.replace(/\s+Chief Agent$/, "") : agent.name;
  const words = own.split(/[\s_-]+/).filter(Boolean);
  const picks = words.length > 1 ? [words[0], words.at(-1)] : words;
  return (
    picks
      .map((word) => [...(word ?? "")][0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

function ChatRow({
  agent,
  active,
  onSelect,
}: {
  agent: Telescope.Agent;
  active: boolean;
  onSelect: () => void;
}) {
  const role = ROLE_LABEL[agent.kind];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        isActive={active}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
      >
        <span
          aria-hidden
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-control-surface text-xs font-medium text-sidebar-foreground"
        >
          {initials(agent)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sidebar-foreground">{agent.name}</span>
          {agent.name === role ? null : (
            <span className="truncate text-xs font-normal">{role}</span>
          )}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SidebarNote({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">{children}</p>;
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <span className="text-xs text-sidebar-muted-foreground">读取失败</span>
      <Button size="xs" variant="outline" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

function ChatGroup({
  label,
  query,
  folded,
  onToggle,
  children,
}: {
  label: string;
  query: EnvironmentQueryView<ReadonlyArray<Telescope.Agent>>;
  folded: boolean;
  onToggle: () => void;
  children: (agents: ReadonlyArray<Telescope.Agent>) => ReactNode;
}) {
  const agents = query.data;
  return (
    <section className="flex flex-col">
      <CollapsibleSectionHeader
        expanded={!folded}
        onClick={onToggle}
        accessory={
          agents === null ? null : <span className="font-normal tabular-nums">{agents.length}</span>
        }
      >
        {label}
      </CollapsibleSectionHeader>
      {folded ? null : agents !== null ? (
        agents.length === 0 ? (
          <SidebarNote>还没有 agent。</SidebarNote>
        ) : (
          <SidebarMenu>{children(agents)}</SidebarMenu>
        )
      ) : query.error !== null ? (
        <LoadFailed onRetry={query.refresh} />
      ) : (
        <div className="flex justify-center py-3">
          <Spinner tone="muted" />
        </div>
      )}
    </section>
  );
}

function selectAgents<E>(
  query: EnvironmentQueryView<{ readonly agents: ReadonlyArray<Telescope.Agent> }, E>,
  keep: (agent: Telescope.Agent) => boolean = () => true,
): EnvironmentQueryView<ReadonlyArray<Telescope.Agent>> {
  return { ...query, data: query.data === null ? null : query.data.agents.filter(keep) };
}

function ChatGroups({
  environmentId,
  workspace,
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const layout = useTasksLayout();
  const selected = useChatAgentId();
  // State, not useLocalStorage: folding must still work when storage refuses the key.
  const [folded, setFolded] = useState(() =>
    readLocalStorageValue(FOLDED_KEY, NONE_FOLDED, FoldedGroups),
  );
  const enterprise = workspace.kind === "enterprise";
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const mine = useEnvironmentQuery(telescopeAgents.listMine(scoped));
  const company = useEnvironmentQuery(enterprise ? telescopeAgents.listCompany(scoped) : null);

  const toggle = (group: ChatGroupId) => {
    const next = folded.includes(group) ? folded.filter((id) => id !== group) : [...folded, group];
    setFolded(next);
    writeLocalStorageValue(FOLDED_KEY, next, NONE_FOLDED, FoldedGroups);
  };
  const rows = (agents: ReadonlyArray<Telescope.Agent>) =>
    agents.map((agent) => (
      <ChatRow
        key={agent.id}
        agent={agent}
        active={agent.id === selected}
        onSelect={() => {
          if (isMobile) setOpenMobile(false);
          void navigate({
            to: TELESCOPE_PATH,
            search: telescopeSearch("chats", layout, undefined, agent.id),
          });
        }}
      />
    ));

  return (
    <div className="flex flex-col gap-2">
      <ChatGroup
        label="我的 Agents"
        query={selectAgents(mine)}
        folded={folded.includes("mine")}
        onToggle={() => toggle("mine")}
      >
        {rows}
      </ChatGroup>
      {enterprise ? (
        <ChatGroup
          label="公司 agents"
          // Other members' exposed agents come back too; they are not the company's own.
          query={selectAgents(company, (agent) => agent.ownerSubjectId === null)}
          folded={folded.includes("company")}
          onToggle={() => toggle("company")}
        >
          {rows}
        </ChatGroup>
      ) : null}
    </div>
  );
}

/** The 对话 sidebar body: the viewer's agents and, in an enterprise workspace, the company's. */
export function TelescopeChatList() {
  const { environmentId, current } = useTelescopeWorkspaces();
  const list = useEnvironmentQuery(
    environmentId === null ? null : telescope.list({ environmentId, input: {} }),
  );
  if (environmentId !== null && current !== null)
    return <ChatGroups environmentId={environmentId} workspace={current} />;
  if (hasNoWorkspace(environmentId, list.data))
    return <SidebarNote>建好或加入一个工作区后，你的对话会列在这里。</SidebarNote>;
  if (list.error !== null) return <LoadFailed onRetry={list.refresh} />;
  return (
    <div className="flex justify-center py-3">
      <Spinner tone="muted" />
    </div>
  );
}
