import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";
import { AgentId, MemoryId, SubjectId, Text, WorkspaceId } from "./common.ts";
import { Memory, MemoryLevel, MemoryScope } from "./runtime.ts";

const MEMORY_SEARCH_MAX_LIMIT = 50;

/** Mem0's four outcomes: add a fact, revise one, retire one, or leave it as it is. */
const MemoryWriteOp = Schema.Literals(["add", "update", "invalidate", "noop"]);

export const MemorySearchQuery = Schema.Struct({
  query: Text.annotate({ description: "Words or a phrase; Chinese substrings match." }),
  agentId: Schema.optionalKey(AgentId),
  scope: Schema.optionalKey(MemoryScope),
  projectId: Schema.optionalKey(ProjectId),
  aboutSubjectId: Schema.optionalKey(SubjectId),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MEMORY_SEARCH_MAX_LIMIT })),
  ),
  includeInvalidated: Schema.optionalKey(Schema.Boolean),
});

/** `add` needs `text`; the other ops need `id`, and `update` also needs the new `text`. */
export const MemoryWrite = Schema.Struct({
  op: MemoryWriteOp,
  id: Schema.optionalKey(MemoryId),
  text: Schema.optionalKey(Text),
  kind: Schema.optionalKey(Text),
  scope: Schema.optionalKey(MemoryScope),
  level: Schema.optionalKey(MemoryLevel),
  projectId: Schema.optionalKey(ProjectId),
  aboutSubjectId: Schema.optionalKey(SubjectId),
  pinned: Schema.optionalKey(Schema.Boolean),
});

const InWorkspace = { workspaceId: WorkspaceId };

export const MemorySearchInput = Schema.Struct({ ...InWorkspace, ...MemorySearchQuery.fields });
export const MemorySearchResult = Schema.Struct({ memories: Schema.Array(Memory) });
export const MemoryWriteInput = Schema.Struct({
  ...InWorkspace,
  agentId: AgentId,
  ...MemoryWrite.fields,
});
export const MemoryPinInput = Schema.Struct({
  ...InWorkspace,
  id: MemoryId,
  pinned: Schema.Boolean,
});
