import { copilotAgents } from "@t3tools/client-runtime/telescope/agents";
import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import { BotIcon, XIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { type ReactNode, useState } from "react";

import { readLocalStorageValue, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useEnvironmentQuery } from "../../state/query";
import { PreviewPanelShell } from "../preview/PreviewPanelShell";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetPopup } from "../ui/sheet";
import { Spinner } from "../ui/spinner";
import { agentDisplayName, telescopeAgents } from "./myTeamsShared";
import { NoWorkspace } from "./TasksParts";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { AgentChat } from "./TelescopeChatPage";
import { useTelescopeWorkspaces } from "./telescopeState";
import { useChatAgentId } from "./telescopeViews";

const OPEN_KEY = "t3code:telescope:copilot-open:v1";
const AGENT_KEY = "t3code:telescope:copilot-agent:v1";
const StoredAgent = Schema.NullOr(Telescope.AgentId);

/** Open or closed, per viewer. State first, so the toggle still works when storage refuses. */
export function useCopilotOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => readLocalStorageValue(OPEN_KEY, false, Schema.Boolean));
  const set = (next: boolean) => {
    setOpen(next);
    writeLocalStorageValue(OPEN_KEY, next, false, Schema.Boolean);
  };
  return [open, set];
}

export function CopilotOpenButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button size="xs" variant="outline" aria-label="打开 Copilot" onClick={onOpen}>
      <BotIcon />
      Copilot
    </Button>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-4">{children}</div>;
}

function PanelHeader({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
      <div className="min-w-0 flex-1">{children}</div>
      <Button size="icon-xs" variant="ghost-muted" aria-label="关闭 Copilot" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}

function CopilotChat({
  environmentId,
  workspace,
  onClose,
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  onClose: () => void;
}) {
  const [stored, setStored] = useState(() => readLocalStorageValue(AGENT_KEY, null, StoredAgent));
  const mainPane = useChatAgentId();
  const mine = useEnvironmentQuery(
    telescopeAgents.listMine({ environmentId, input: { workspaceId: workspace.id } }),
  );
  const { choices, shown } = copilotAgents(mine.data?.agents ?? [], stored, mainPane);
  const pick = (agentId: Telescope.AgentId | null) => {
    if (agentId === null) return;
    setStored(agentId);
    writeLocalStorageValue(AGENT_KEY, agentId, null, StoredAgent);
  };
  return (
    <>
      <PanelHeader onClose={onClose}>
        {shown === null ? null : (
          <Select value={shown.id} onValueChange={pick}>
            <SelectTrigger size="sm" variant="ghost" aria-label="Copilot 对话的 agent">
              <SelectValue>{agentDisplayName(shown)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {choices.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agentDisplayName(agent)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        {shown !== null ? (
          <AgentChat
            key={shown.id}
            environmentId={environmentId}
            workspace={workspace}
            agent={shown}
          />
        ) : mine.data !== null ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyDescription>还没有 agent。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : mine.error !== null ? (
          <Centered>
            <ErrorNote text="读取失败" onRetry={mine.refresh} />
          </Centered>
        ) : (
          <Centered>
            <Spinner tone="muted" />
          </Centered>
        )}
      </div>
    </>
  );
}

function CopilotBody({ onClose }: { onClose: () => void }) {
  const { environmentId, current } = useTelescopeWorkspaces();
  if (environmentId !== null && current !== null)
    return <CopilotChat environmentId={environmentId} workspace={current} onClose={onClose} />;
  return (
    <>
      <PanelHeader onClose={onClose} />
      <NoWorkspace />
    </>
  );
}

// The embedded ChatView header pads for the collapsed-sidebar toggle; here it sits at the right edge.
const FRAME =
  "flex min-h-0 flex-1 flex-col [--workspace-titlebar-content-left:var(--workspace-gutter-start)]";

/** The agent chat beside 任务, 决定 and Dashboard; a sheet on narrow windows. Mounted only while open. */
export function TelescopeCopilotPanel({ onClose }: { onClose: () => void }) {
  const narrow = useMediaQuery("max-lg");
  const body = (
    <div className={FRAME}>
      <CopilotBody onClose={onClose} />
    </div>
  );
  if (narrow)
    return (
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <SheetPopup showCloseButton={false} aria-label="Copilot">
          {body}
        </SheetPopup>
      </Sheet>
    );
  return (
    <PreviewPanelShell
      mode="inline"
      widthStorageKey="t3code:telescope:copilot-width"
      defaultWidth={420}
    >
      {body}
    </PreviewPanelShell>
  );
}
