// PROTOTYPE, wipe me. Small pieces shared by the non-chat views of Lighthouse.
import { MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import {
  PROJECTS,
  VIEWERS,
  projectsIn,
  isEnterprise,
  type LighthouseView,
  type LighthouseViewer,
} from "./lighthouseData";
import { setTeamsTab, useTeamsTab } from "./lighthouseActions";
import { useWorkspaceId } from "./workspaceStore";
import { Button } from "../ui/button";

export function projectName(id: string): string {
  return PROJECTS[id]?.name ?? id;
}

export function ThreadAnchor({ id, muted }: { id: string; muted?: boolean }) {
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      className={cn(
        "inline-flex items-center gap-1 underline-offset-4 hover:underline",
        muted ? "text-muted-foreground" : "text-primary",
      )}
    >
      <MessageSquareIcon className="size-3.5" />
      {id}
    </a>
  );
}

const TEAMS_TABS = [
  { id: "mine", label: "我的 agents" },
  { id: "company", label: "公司 agents" },
  { id: "skills", label: "Skills" },
] as const;

function TeamsSubList() {
  const enterprise = isEnterprise(useWorkspaceId());
  const picked = useTeamsTab();
  const tab = picked === "company" && !enterprise ? "mine" : picked;
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-1">
      {TEAMS_TABS.filter((t) => enterprise || t.id !== "company").map((t) => (
        <Button
          key={t.id}
          size="sm"
          variant={tab === t.id ? "secondary" : "ghost-muted"}
          className="justify-start"
          onClick={() => setTeamsTab(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}

export function WorkSubList({ view, viewer }: { view: LighthouseView; viewer: LighthouseViewer }) {
  if (view === "teams") return <TeamsSubList />;
  return <PlainSubList view={view} viewer={viewer} />;
}

function PlainSubList({ view, viewer }: { view: LighthouseView; viewer: LighthouseViewer }) {
  const workspace = useWorkspaceId();
  const open = projectsIn(workspace, viewer).open;
  const items =
    view === "tasks"
      ? ["全部任务", ...open.map(projectName)]
      : view === "members"
        ? [VIEWERS[viewer].title]
        : ["全部", ...open.map(projectName)];
  const [active, setActive] = useState(0);
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-1">
      {items.map((label, i) => (
        <Button
          key={label}
          size="sm"
          variant={active === i ? "secondary" : "ghost-muted"}
          className="justify-start"
          onClick={() => setActive(i)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
