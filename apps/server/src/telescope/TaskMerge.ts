import type { Telescope } from "@t3tools/contracts";
import type * as Schema from "effect/Schema";

type Fields = Record<string, Schema.Json>;

/** `fields` merged cleanly or by rule; `conflicts` names the fields no rule settles. */
export type MergeOutcome = {
  readonly fields: Fields;
  readonly conflicts: ReadonlyArray<string>;
  readonly mergeLevel: 0 | 1;
  readonly mergeReason: string;
};

/** Field values a task has before any commit sets them. */
const DEFAULTS: Fields = { status: "todo", goalChain: [] };
const STATUS_RANK = new Map<Schema.Json, number>([
  ["todo", 0],
  ["in_progress", 1],
  ["in_review", 2],
  ["done", 3],
]);

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Status only moves forward; `dropped` is terminal and `needs_decision` holds until a person
 * moves it. `undefined` when neither rule decides.
 */
const statusWinner = (mine: Schema.Json, current: Schema.Json) => {
  if (current === "dropped" || current === "needs_decision") return "theirs";
  if (mine === "dropped" || mine === "needs_decision")
    return current === "done" ? undefined : "mine";
  const m = STATUS_RANK.get(mine);
  const c = STATUS_RANK.get(current);
  if (m === undefined || c === undefined) return undefined;
  return m > c ? "mine" : "theirs";
};

/**
 * Three-way merge of a write made against `baseVersion` onto `current`. `mine` holds the fields
 * that differ from `current`; `history` is every commit of the task. The base value of a field is
 * replayed from the commits before the base, so resending an unchanged field is not a conflict.
 */
export const mergeStale = (input: {
  readonly current: Telescope.Task;
  readonly mine: Fields;
  readonly history: ReadonlyArray<Telescope.TaskCommit>;
  readonly baseVersion: number;
  readonly authorId: string;
  readonly leaseHolder: string | undefined;
}): MergeOutcome => {
  const base: Fields = { ...DEFAULTS };
  const touchedBy = new Map<string, Set<string>>();
  for (const commit of input.history.toSorted((a, b) => a.baseVersion - b.baseVersion)) {
    for (const [key, value] of Object.entries(commit.changedFields)) {
      if (commit.baseVersion < input.baseVersion) base[key] = value;
      else touchedBy.set(key, (touchedBy.get(key) ?? new Set()).add(commit.authorId));
    }
  }

  const fields: Fields = {};
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const current: Readonly<Record<string, unknown>> = input.current;
  for (const [key, value] of Object.entries(input.mine)) {
    const theirs = touchedBy.get(key);
    if (theirs === undefined) {
      fields[key] = value;
      continue;
    }
    if (sameJson(value, base[key])) continue;
    const holder = input.leaseHolder;
    const byStatus = key === "status" ? statusWinner(value, input.current.status) : undefined;
    const byLease =
      holder === undefined
        ? undefined
        : input.authorId === holder
          ? "mine"
          : theirs.has(holder)
            ? "theirs"
            : undefined;
    const winner = byStatus ?? byLease;
    if (winner === undefined) {
      conflicts.push(key);
      continue;
    }
    if (winner === "mine") fields[key] = value;
    const kept = JSON.stringify(winner === "mine" ? value : (current[key] ?? null));
    const rule = byStatus === undefined ? "lease holder wins" : "status only moves forward";
    reasons.push(`${key}: ${rule}, kept ${kept}`);
  }
  const rebased = `rebased from version ${input.baseVersion}`;
  return {
    fields,
    conflicts,
    mergeLevel: reasons.length === 0 ? 0 : 1,
    mergeReason: [rebased, ...reasons].join("; "),
  };
};
