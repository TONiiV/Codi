import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";
import { AgentId, MemoryId, SubjectId, Text, WorkspaceId } from "./common.ts";
import { Memory, MemoryLevel, MemoryScope } from "./runtime.ts";

const MEMORY_SEARCH_MAX_LIMIT = 50;
/** A memory is a note, not a document; search results carry the whole text. */
const MEMORY_TEXT_MAX_LENGTH = 20_000;
/** Ids are uuids, revision ids or auth subjects; the cap only stops megabyte ids being stored. */
const idLength = Schema.isMaxLength(128);
/** Every term becomes one SQL clause on the writer connection. */
const MEMORY_QUERY_MAX_LENGTH = 200;

/** Mem0's four outcomes: add a fact, revise one, retire one, or leave it as it is. */
const MemoryWriteOp = Schema.Literals(["add", "update", "invalidate", "noop"]);

export const MemorySearchQuery = Schema.Struct({
  query: Text.check(
    Schema.isMaxLength(MEMORY_QUERY_MAX_LENGTH),
    // FTS5 reads a NUL as the end of the MATCH string and reports a syntax error.
    Schema.isPattern(/^[^\0]*$/),
  ).annotate({ description: "Words or a phrase; Chinese substrings match." }),
  agentId: Schema.optionalKey(AgentId.check(idLength)),
  scope: Schema.optionalKey(
    MemoryScope.annotate({ description: "Only memories of this scope. Omit to search all." }),
  ),
  projectId: Schema.optionalKey(ProjectId.check(idLength)),
  aboutSubjectId: Schema.optionalKey(SubjectId.check(idLength)),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MEMORY_SEARCH_MAX_LIMIT })),
  ),
  includeInvalidated: Schema.optionalKey(Schema.Boolean),
});

/** `add` needs `text`; the other ops need `id`, and `update` also needs the new `text`. */
export const MemoryWrite = Schema.Struct({
  op: MemoryWriteOp.annotate({
    description: "add needs text; update needs id and text; invalidate and noop need id.",
  }),
  id: Schema.optionalKey(MemoryId.check(idLength)),
  text: Schema.optionalKey(Text.check(Schema.isMaxLength(MEMORY_TEXT_MAX_LENGTH))),
  kind: Schema.optionalKey(
    Text.check(Schema.isMaxLength(64)).annotate({
      description: "fact (default), preference, decision or another short label.",
    }),
  ),
  scope: Schema.optionalKey(
    MemoryScope.annotate({
      description:
        "personal (default), project (with projectId) or person (company agents, with aboutSubjectId).",
    }),
  ),
  level: Schema.optionalKey(
    MemoryLevel.annotate({
      description: "private: only this agent can read it. confidential or internal: every member.",
    }),
  ),
  projectId: Schema.optionalKey(ProjectId.check(idLength)),
  aboutSubjectId: Schema.optionalKey(SubjectId.check(idLength)),
  pinned: Schema.optionalKey(Schema.Boolean),
});

const InWorkspace = { workspaceId: WorkspaceId.check(idLength) };

export const MemorySearchInput = Schema.Struct({ ...InWorkspace, ...MemorySearchQuery.fields });
export const MemorySearchResult = Schema.Struct({ memories: Schema.Array(Memory) });
export const MemoryWriteInput = Schema.Struct({
  ...InWorkspace,
  agentId: AgentId.check(idLength),
  ...MemoryWrite.fields,
});
export const MemoryPinInput = Schema.Struct({
  ...InWorkspace,
  id: MemoryId,
  pinned: Schema.Boolean,
});
