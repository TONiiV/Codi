import { Telescope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** Recorded on every run as `inputSnapshot.promptVersion`; bump it when the role text changes. */
export const PROMPT_VERSION = "telescope-agent-instructions@4";

/** What a wake carries; D3b enqueues `message`, the listener `worker` when a Worker's turn ends. */
export const WakePayload = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("message"), text: Telescope.Text }),
  Schema.Struct({
    kind: Schema.Literals(["delegation", "report", "worker"]),
    delegationId: Telescope.DelegationId,
  }),
]);
export type WakePayload = typeof WakePayload.Type;

export type TurnItem =
  | { readonly kind: "message"; readonly text: string }
  | {
      readonly kind: "delegation" | "report" | "worker";
      readonly delegation: Telescope.Delegation;
    };

const ASSISTANT = [
  "You are {name}, a Telescope personal assistant working for one member. This is your resident thread: each turn starts with a message from your member or a report from an agent you delegated to.",
  "- Answer questions, keep the task board current and use memory yourself.",
  "- Do not do project work yourself: do not edit files, run builds or open threads. Hand it to that project's Chief Agent with `delegate`, as a brief: goal, constraints, deadline, acceptance criteria, preferences and the goal chain it serves. Never forward the chat.",
  "- When a report comes back, tell your member in a few lines what happened, what was decided and what needs them. Link threads instead of retelling them.",
].join("\n");
const CHIEF = [
  "You are {name}, the Chief Agent of one project in Telescope. This is your resident thread: each turn starts with a task delegated to you, by its task id, or a message from your member.",
  "- Do not write code or run the work yourself. Open a Worker for it with `dispatch_worker` and a brief; the Worker works in its own thread.",
  "- Report on the task id with `delegation_report`: the state, the result, decisions taken, what blocks it and who must decide. Link threads instead of pasting them.",
  "- A turn on a delegated task that ends without `delegation_report` and without an open Worker fails the task as unreported.",
].join("\n");

const list = (label: string, values: ReadonlyArray<string> | undefined) =>
  values === undefined || values.length === 0 ? [] : [`${label}:`, ...values.map((v) => `- ${v}`)];

/** A Worker's first and only message, and the body of a delegated task's turn. */
export const renderBrief = (brief: typeof Telescope.DelegationBrief.Type) =>
  [
    `Goal: ${brief.goal}`,
    ...list("Goal chain", brief.goalChain),
    ...list("Constraints", brief.constraints),
    ...(brief.deadline === undefined ? [] : [`Deadline: ${brief.deadline}`]),
    ...list("Acceptance", brief.acceptance),
    ...list("Preferences", brief.preferences),
  ].join("\n");

const delegationText = (delegation: Telescope.Delegation) =>
  `Delegated task ${delegation.id} from agent ${delegation.fromAgentId}.\n${renderBrief(delegation.brief)}`;

const workerText = (delegation: Telescope.Delegation) =>
  [
    `Your Worker on task ${delegation.id} ended its turn.`,
    `Goal: ${delegation.brief.goal}`,
    "Read the Worker's thread (the Worker task in `delegation_list` names it). Close the Worker task with `delegation_report`, then report on this task, or open another Worker with `dispatch_worker`.",
  ].join("\n");

const reportText = (delegation: Telescope.Delegation) => {
  const report = delegation.report;
  return [
    `Report on task ${delegation.id} from agent ${delegation.toAgentId}: ${delegation.state}.`,
    `Goal: ${delegation.brief.goal}`,
    ...(report === undefined || report.result === "" ? [] : [`Result: ${report.result}`]),
    ...list("Decisions", report?.decisions),
    ...(report?.blockedOn === undefined ? [] : [`Blocked on: ${report.blockedOn}`]),
    ...(report?.needsFrom === undefined ? [] : [`Needs: ${report.needsFrom}`]),
    ...(delegation.threadId === undefined ? [] : [`Thread: ${delegation.threadId}`]),
  ].join("\n");
};

/** One wake's turn text; a new resident thread's first turn starts with the agent's role. */
export const renderTurn = (
  agent: Pick<Telescope.Agent, "kind" | "name">,
  items: ReadonlyArray<TurnItem>,
  options: { readonly firstTurn: boolean },
) => {
  const role = (agent.kind === "chief_agent" ? CHIEF : ASSISTANT).replace("{name}", agent.name);
  const parts = items.map((item) =>
    item.kind === "message"
      ? `Message from your member:\n${item.text}`
      : item.kind === "delegation"
        ? delegationText(item.delegation)
        : item.kind === "worker"
          ? workerText(item.delegation)
          : reportText(item.delegation),
  );
  return [...(options.firstTurn ? [role] : []), ...parts].join("\n\n");
};
