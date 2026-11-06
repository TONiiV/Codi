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
    "Search your Telescope long-term memory. Search before you answer about earlier decisions, people or preferences. Pinned memories come first. Retired facts are hidden unless includeInvalidated.",
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
    "Record what should outlast this thread: standing instructions, decisions, and facts about people and projects; kind defaults to fact. op add stores a new memory; update replaces one and keeps the old revision; invalidate retires one; noop leaves it. level defaults to private (only you, this agent, can read it); a company agent defaults to confidential (every workspace member can read it). update keeps the current level unless you pass one.",
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
