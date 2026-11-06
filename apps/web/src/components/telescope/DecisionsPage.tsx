import { decideInput, sortDecisions } from "@t3tools/client-runtime/telescope/taskBoard";
import type { Telescope } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { TelescopeEmptyState } from "./TelescopeShell";
import { telescopeBoard } from "./telescopeState";
import {
  BoardFrame,
  type BoardTarget,
  NoWorkspace,
  useBoardCommand,
  useBoardNames,
  useBoardTarget,
} from "./TasksParts";

const GROUPS = [
  { status: "proposed", label: "待决定", badge: "warning" },
  { status: "decided", label: "已决定", badge: "success" },
  { status: "superseded", label: "已被取代", badge: "outline" },
] as const;

/** A merge conflict records both sides as JSON; anything else is prose. */
function readableText(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function DecisionItem(props: {
  decision: Telescope.Decision;
  group: (typeof GROUPS)[number];
  author: string;
  onDecide: ((optionId: string) => void) | null;
}) {
  const { decision } = props;
  const chosen = decision.options?.find((option) => option.id === decision.chosen);
  const meta = [props.author, new Date(decision.decidedAt ?? decision.createdAt).toLocaleString()];
  if (chosen) meta.push(`选了「${chosen.label}」`);
  return (
    <li
      id={decision.id}
      className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm target:ring-2 target:ring-primary/40"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{decision.title}</span>
        <Badge variant={props.group.badge}>{props.group.label}</Badge>
      </span>
      <span className="text-xs text-muted-foreground">{meta.join(" · ")}</span>
      {decision.text ? (
        <p className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">
          {readableText(decision.text)}
        </p>
      ) : null}
      {props.onDecide && decision.options?.length ? (
        <span className="flex flex-wrap gap-2 pt-1">
          {decision.options.map((option) => (
            <Button
              key={option.id}
              size="xs"
              variant="outline"
              onClick={() => props.onDecide?.(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </span>
      ) : null}
    </li>
  );
}

function DecisionsBody({ target }: { target: BoardTarget }) {
  const input = { workspaceId: target.workspaceId };
  const query = useEnvironmentQuery(
    telescopeBoard.decisions({ environmentId: target.environmentId, input }),
  );
  const names = useBoardNames(target);
  const decide = useBoardCommand(telescopeBoard.createDecision);
  const [deciding, setDeciding] = useState(false);
  const decisions = sortDecisions(query.data?.decisions ?? []);
  const choose = async (proposal: Telescope.Decision, optionId: string) => {
    setDeciding(true);
    await decide({ environmentId: target.environmentId, input: decideInput(proposal, optionId) });
    setDeciding(false);
  };
  return (
    <BoardFrame query={query}>
      {decisions.length === 0 ? (
        <TelescopeEmptyState view="decisions" />
      ) : (
        <div className="flex max-w-3xl flex-col gap-6 p-4">
          {GROUPS.map((group) => {
            const items = decisions.filter((decision) => decision.status === group.status);
            if (items.length === 0) return null;
            return (
              <section key={group.status} className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {group.label} · {items.length}
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((decision) => (
                    <DecisionItem
                      key={decision.id}
                      decision={decision}
                      group={group}
                      author={names(decision.decidedBy ?? decision.authorId) ?? "其他成员"}
                      onDecide={
                        group.status === "proposed" && !deciding
                          ? (optionId) => void choose(decision, optionId)
                          : null
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </BoardFrame>
  );
}

export function DecisionsPage() {
  const target = useBoardTarget();
  return target === null ? <NoWorkspace /> : <DecisionsBody target={target} />;
}
