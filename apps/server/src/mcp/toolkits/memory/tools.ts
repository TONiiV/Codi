import { OrchestratorMcpFailure, Telescope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as MemoryService from "../../../telescope/MemoryService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  MemoryService.MemoryService,
];

// Tool names avoid dots: provider tool-name patterns reject them.
const MemorySearchTool = Tool.make("memory_search", {
  description:
    "Search your Telescope long-term memory. Pinned memories come first. Retired facts are hidden unless includeInvalidated.",
  parameters: Telescope.MemorySearchQuery,
  success: Telescope.MemorySearchResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Search memory")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const MemoryWriteTool = Tool.make("memory_write", {
  description:
    "Record what you learned. op add (text) stores a new fact; update (id, text) replaces a fact and keeps the old revision; invalidate (id) retires one; noop (id) leaves it. level defaults to private.",
  parameters: Telescope.MemoryWrite,
  success: Schema.Struct({ memory: Telescope.Memory }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Write memory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const MemoryToolkit = Toolkit.make(MemorySearchTool, MemoryWriteTool);
