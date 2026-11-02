// PROTOTYPE, wipe me. Per project, the chain of decisions that led to where it is now. Each
// node names its owner and source; the project Chief of Staff keeps the chain current.
import { LockIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import { ThreadAnchor } from "./LighthouseWork";
import {
  DECISION_CHAINS,
  PROJECT_COS,
  PROJECTS,
  projectsIn,
  type DecisionNode,
  type DecisionWeight,
  type LighthouseViewer,
} from "./lighthouseData";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const WEIGHT_FILTERS = [
  { id: "all", label: "全部" },
  { id: "major", label: "关键 + 重要" },
  { id: "key", label: "仅关键" },
] as const;
type WeightFilter = (typeof WEIGHT_FILTERS)[number]["id"];

function visible(weight: DecisionWeight, filter: WeightFilter) {
  if (filter === "all") return true;
  if (filter === "major") return weight !== "minor";
  return weight === "key";
}

function NodeDot({ node }: { node: DecisionNode }) {
  return (
    <span
      className={cn(
        "relative z-10 shrink-0 rounded-full",
        node.weight === "key" && "size-3.5 ring-4 ring-background",
        node.weight === "major" && "size-2.5 border-2 ring-4 ring-background",
        node.weight === "minor" && "size-1.5 ring-4 ring-background",
        node.state === "open" && "border-warning bg-warning",
        node.state !== "open" && node.weight === "key" && "bg-foreground",
        node.state !== "open" && node.weight === "major" && "border-foreground bg-background",
        node.state !== "open" && node.weight === "minor" && "bg-muted-foreground",
        (node.state === "rejected" || node.state === "replaced") && "opacity-50",
      )}
    />
  );
}

function StateBadge({ node }: { node: DecisionNode }) {
  if (node.state === "open") return <Badge variant="warning">待定</Badge>;
  if (node.state === "rejected") return <Badge variant="error">否决</Badge>;
  if (node.state === "replaced") return <Badge variant="outline">被取代</Badge>;
  return null;
}

function Node({ node }: { node: DecisionNode }) {
  const faded = node.state === "rejected" || node.state === "replaced";
  return (
    <li className="relative flex gap-4 pb-5">
      <div className="flex w-4 shrink-0 justify-center pt-1.5">
        <NodeDot node={node} />
      </div>
      <div className={cn("min-w-0 flex-1", faded && "text-muted-foreground")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">
            {node.when}
          </span>
          {node.weight === "key" ? <Badge variant="secondary">关键</Badge> : null}
          <span
            className={cn(
              node.weight === "key" && "text-base font-semibold",
              node.weight === "major" && "text-sm font-medium",
              node.weight === "minor" && "text-sm text-muted-foreground",
              node.state === "rejected" && "line-through",
            )}
          >
            {node.title}
          </span>
          <StateBadge node={node} />
        </div>
        {node.weight === "minor" ? null : (
          <p className="mt-1 ms-12 text-sm text-muted-foreground">{node.why}</p>
        )}
        <div className="mt-1 ms-12 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {node.owner[0]}
            </span>
            {node.owner}
          </span>
          <ThreadAnchor id={node.source} muted={faded} />
        </div>
      </div>
    </li>
  );
}

function Chain({ project, filter }: { project: string; filter: WeightFilter }) {
  const chain = DECISION_CHAINS[project];
  const cos = PROJECT_COS[project];
  if (!chain || !cos) return null;
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{PROJECTS[project]?.name}</h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <BotAvatar tone={cos.tone} size="xs" />
          {cos.name} 维护 · {chain.updated} 更新
        </span>
      </header>
      <ol className="relative before:absolute before:start-2 before:top-2 before:bottom-2 before:w-px before:-translate-x-1/2 before:bg-border">
        {chain.nodes
          .filter((n) => visible(n.weight, filter))
          .map((n) => (
            <Node key={n.id} node={n} />
          ))}
        <li className="relative flex gap-4">
          <div className="flex w-4 shrink-0 justify-center pt-1">
            <span className="relative z-10 size-4 rounded-full bg-primary ring-4 ring-background" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-primary">现状</div>
            <div className="text-sm">{chain.now}</div>
          </div>
        </li>
      </ol>
    </section>
  );
}

export function DecisionsPage({
  viewer,
  workspace,
}: {
  viewer: LighthouseViewer;
  workspace: string;
}) {
  const [filter, setFilter] = useState<WeightFilter>("all");
  const { all, open } = projectsIn(workspace, viewer);
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">决定</h1>
        <div className="flex gap-1">
          {WEIGHT_FILTERS.map((f) => (
            <Button
              key={f.id}
              size="xs"
              variant={filter === f.id ? "secondary" : "ghost-muted"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>
      {all.map((id) =>
        open.includes(id) ? (
          <Chain key={id} project={id} filter={filter} />
        ) : (
          <div key={id} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <LockIcon className="size-3.5" />
            {PROJECTS[id]?.name}
          </div>
        ),
      )}
    </div>
  );
}
