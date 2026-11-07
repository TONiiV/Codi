import { Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

import { ServerConfig } from "../config.ts";
import * as ContextBudget from "./ContextBudget.ts";
import * as MemoryService from "./MemoryService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import type * as WorkspaceService from "./WorkspaceService.ts";

const RECALL_LIMIT = 50;
const CLOSED: ReadonlyArray<Telescope.TaskStatus> = ["done", "dropped"];

type Manifest = Telescope.AgentRun["inputSnapshot"]["contextManifest"];
type Failure =
  | MemoryService.Failure
  | Telescope.StaleTaskVersionError
  | Telescope.FreeTextLimitError
  | PlatformError;

interface AssembleInput {
  /** The auth session the run acts through, as given to `RunRecordService.start`. */
  readonly caller: WorkspaceService.Caller;
  readonly run: typeof Telescope.RunScopedInput.Type;
  readonly windowTokens: number;
  /** What the window holds besides this context: the harness prompt and the work so far. */
  readonly usedTokens: number;
  /** Words for the memory search, such as the task title; without them nothing is recalled. */
  readonly query?: string;
  /** The current thread's messages, oldest first. */
  readonly thread: ReadonlyArray<{ readonly id: string; readonly text: string }>;
}
interface Assembled {
  readonly path: string;
  readonly manifest: Manifest;
  readonly tokens: number;
  readonly compacted: boolean;
}

/** Where a run's context file is written; deleting its workspace removes it. */
export const contextFile = (path: Path.Path, stateDir: string, runId: string) =>
  path.join(stateDir, "telescope", "context", `${runId}.md`);

const memoryItem = (memory: Telescope.Memory): ContextBudget.ContextItem => ({
  kind: memory.layer === "diary" ? "diary" : "memory",
  id: memory.id,
  text: memory.text,
});
const newestFirst = (a: { readonly updatedAt: string }, b: { readonly updatedAt: string }) =>
  b.updatedAt.localeCompare(a.updatedAt);

/**
 * Builds a run's context before it starts: pinned memory, the task board, recalled memories and
 * the current thread, each within its share of the window. Writes the context file and adds what
 * it holds to the run's context manifest.
 */
export class ContextAssembler extends Context.Service<
  ContextAssembler,
  { readonly assemble: (input: AssembleInput) => Effect.Effect<Assembled, Failure> }
>()("t3/telescope/ContextAssembler") {}

const make = Effect.gen(function* () {
  const memory = yield* MemoryService.MemoryService;
  const board = yield* TaskBoardService.TaskBoardService;
  const runs = yield* RunRecordService.RunRecordService;
  const digest = yield* Digest.Digest;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig;

  const hash = (text: string) =>
    digest
      .digest(Digest.sha256, new TextEncoder().encode(text))
      .pipe(Effect.orDie, Effect.map(Hex.encode));

  const assemble = Effect.fn("ContextAssembler.assemble")(function* (input: AssembleInput) {
    const { workspaceId } = input.run;
    const run = yield* runs.get(input.caller, input.run);
    const [memberId] = run.onBehalfOf;
    if (run.finishedAt !== undefined || run.threadId === undefined || memberId === undefined)
      return yield* new Telescope.WorkspaceError({
        reason: "conflict",
        message: "Only an open run attached to its thread gets a context.",
      });
    const agent: MemoryService.ThreadAgent = {
      memberId,
      workspaceId,
      run: { runId: run.id, agentId: run.agentId, threadId: run.threadId },
    };

    const pinned = yield* memory.pinned(agent);
    const pinnedIds = new Set(pinned.map((item) => item.id));
    const recalled =
      input.query === undefined || input.query.trim() === ""
        ? []
        : (yield* memory.search(agent, { workspaceId, query: input.query, limit: RECALL_LIMIT }))
            .memories;
    const actor = { caller: input.caller };
    const { tasks } = yield* board.listTasks(actor, { workspaceId });
    const { decisions } = yield* board.listDecisions(actor, { workspaceId });
    const open = tasks.filter((task) => !CLOSED.includes(task.status)).toSorted(newestFirst);
    const own = (task: Telescope.Task) => task.ownerAgentId === run.agentId;

    const { blocks, tokens, compacted } = ContextBudget.allocate({
      windowTokens: input.windowTokens,
      usedTokens: input.usedTokens,
      blocks: {
        pinned: pinned.map(memoryItem),
        board: [
          ...open.filter(own),
          ...decisions.filter((decision) => decision.status !== "superseded").toSorted(newestFirst),
          ...open.filter((task) => !own(task)),
        ].map(ContextBudget.boardItem),
        recall: recalled.filter((item) => !pinnedIds.has(item.id)).map(memoryItem),
        thread: input.thread.toReversed().map((message) => ({ kind: "thread", ...message })),
      },
    });
    const ordered = { ...blocks, thread: blocks.thread.toReversed() };
    const manifest = yield* Effect.forEach(
      ContextBudget.BLOCK_NAMES.flatMap((name) => ordered[name]),
      (item) =>
        hash(item.text).pipe(Effect.map((h) => ({ kind: item.kind, id: item.id, hash: h }))),
    );

    const file = contextFile(path, stateDir, run.id);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, ContextBudget.renderContextFile(ordered));
    yield* runs.recordContextManifest(input.run, manifest);
    return { path: file, manifest, tokens, compacted };
  });

  return ContextAssembler.of({ assemble });
});

export const layer = Layer.effect(ContextAssembler, make).pipe(
  Layer.provide(
    Layer.mergeAll(MemoryService.layer, TaskBoardService.layer, RunRecordService.layer),
  ),
);
