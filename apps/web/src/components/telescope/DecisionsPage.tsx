import {
  DECISION_STATUSES,
  decideFailureText,
  decideInput,
  decisionOptionsLocked,
  sortDecisions,
} from "@t3tools/client-runtime/telescope/taskBoard";
import type { Telescope } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
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

const GROUPS = {
  proposed: { label: "待决定", badge: "warning" },
  decided: { label: "已决定", badge: "success" },
  superseded: { label: "已被取代", badge: "outline" },
} as const satisfies Record<Telescope.DecisionStatus, { label: string; badge: string }>;

// Telescope copy is Chinese whatever the app language, so its timestamps are too.
const TIME = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

const scrollIntoView = (node: HTMLLIElement | null) => node?.scrollIntoView({ block: "nearest" });

type DecisionOption = NonNullable<Telescope.Decision["options"]>[number];
type Choice = { readonly proposal: Telescope.Decision; readonly option: DecisionOption };

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
  author: string;
  highlighted: boolean;
  onChoose: ((option: DecisionOption) => void) | null;
  busy: boolean;
}) {
  const { decision } = props;
  const group = GROUPS[decision.status];
  const chosen = decision.options?.find((option) => option.id === decision.chosen);
  const meta = [props.author, TIME.format(new Date(decision.decidedAt ?? decision.createdAt))];
  if (chosen) meta.push(`选了「${chosen.label}」`);
  return (
    <li
      id={decision.id}
      ref={props.highlighted ? scrollIntoView : undefined}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3 text-sm",
        props.highlighted && "ring-2 ring-primary/40",
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium wrap-anywhere">{decision.title}</span>
        <Badge variant={group.badge}>{group.label}</Badge>
      </span>
      <span className="text-xs text-muted-foreground">{meta.join(" · ")}</span>
      {decision.text ? (
        <p className="line-clamp-6 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {readableText(decision.text)}
        </p>
      ) : null}
      {props.onChoose && decision.options?.length ? (
        <span className="flex flex-wrap gap-2 pt-1">
          {decision.options.map((option) => (
            <Button
              key={option.id}
              size="xs"
              variant="outline"
              disabled={props.busy}
              onClick={() => props.onChoose?.(option)}
            >
              {option.label}
            </Button>
          ))}
        </span>
      ) : null}
    </li>
  );
}

function ConfirmDecision(props: {
  open: boolean;
  choice: Choice | null;
  onCancel: () => void;
  onConfirm: (choice: Choice) => void;
}) {
  const { choice } = props;
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>选择「{choice?.option.label}」？</AlertDialogTitle>
          <AlertDialogDescription>
            「{choice?.proposal.title}」会记成已决定，原提议被取代。决定后不能撤回。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
          <Button onClick={() => choice && props.onConfirm(choice)}>决定</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function DecisionsBody({ target }: { target: BoardTarget }) {
  const input = { workspaceId: target.workspaceId };
  const query = useEnvironmentQuery(
    telescopeBoard.decisions({ environmentId: target.environmentId, input }),
  );
  const names = useBoardNames(target);
  const decide = useBoardCommand(telescopeBoard.createDecision, decideFailureText);
  const hash = useLocation({ select: (location) => location.hash.replace(/^#/, "") });
  const [choice, setChoice] = useState<Choice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const busy = decisionOptionsLocked({
    sentAt,
    isPending: query.isPending,
    dataUpdatedAt: query.dataUpdatedAt,
  });
  const decisions = sortDecisions(query.data?.decisions ?? []);
  const confirm = async ({ proposal, option }: Choice) => {
    setConfirming(false);
    setSentAt(Date.now());
    const input = decideInput(proposal, option.id);
    if (!(await decide({ environmentId: target.environmentId, input }))) setSentAt(null);
  };
  return (
    <BoardFrame query={query}>
      {decisions.length === 0 ? (
        <TelescopeEmptyState view="decisions" />
      ) : (
        <div className="flex max-w-3xl flex-col gap-6 p-4">
          {DECISION_STATUSES.map((status) => {
            const items = decisions.filter((decision) => decision.status === status);
            if (items.length === 0) return null;
            return (
              <section key={status} className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {GROUPS[status].label} · {items.length}
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((decision) => (
                    <DecisionItem
                      key={decision.id}
                      decision={decision}
                      author={names(decision.decidedBy ?? decision.authorId) ?? "其他成员"}
                      highlighted={decision.id === hash}
                      busy={busy}
                      onChoose={
                        status === "proposed"
                          ? (option) => {
                              setChoice({ proposal: decision, option });
                              setConfirming(true);
                            }
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
      <ConfirmDecision
        open={confirming}
        choice={choice}
        onCancel={() => setConfirming(false)}
        onConfirm={(next) => void confirm(next)}
      />
    </BoardFrame>
  );
}

export function DecisionsPage() {
  const target = useBoardTarget();
  return target === null ? <NoWorkspace /> : <DecisionsBody target={target} />;
}
