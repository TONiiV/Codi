import { parseTimestampMs, tokenCount } from "@t3tools/provider-core/server/usage";

export interface ToolCall {
  readonly name: string;
  readonly filePath?: string;
  /** Read's offset and limit, so reading another part of a file is not a repeat. */
  readonly range?: string;
  resultTokens: number;
}

/** What one Claude session did inside the report window. */
export interface SessionActivity {
  readonly sessionId: string;
  cwd: string;
  startMs: number;
  endMs: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  userPrompts: number;
  readonly toolCalls: ToolCall[];
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
const asBlocks = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.flatMap((block: unknown) => {
        const object = asObject(block);
        return object === undefined ? [] : [object];
      })
    : [];
const asString = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Text length over four is the usual estimate; transcripts do not record result tokens. */
const textTokens = (content: unknown): number => {
  if (typeof content === "string") return Math.ceil(content.length / 4);
  return asBlocks(content).reduce((sum, block) => sum + textTokens(block["text"] ?? ""), 0);
};

/** Folds Claude Code transcript lines into per-session activity, keeping lines inside the window. */
export const makeSessionCollector = (window: {
  readonly sinceMs: number;
  readonly untilMs: number;
}) => {
  const sessions = new Map<string, SessionActivity>();
  const pendingResults = new Map<string, ToolCall>();
  const countedMessages = new Set<string>();

  const add = (line: string) => {
    let record: Json | undefined;
    try {
      record = asObject(JSON.parse(line));
    } catch {
      return;
    }
    const sessionId = asString(record?.["sessionId"]);
    const at = parseTimestampMs(record?.["timestamp"]);
    const message = asObject(record?.["message"]);
    if (record === undefined || sessionId === undefined || at === null || message === undefined)
      return;
    if (at < window.sinceMs || at >= window.untilMs) return;
    let session = sessions.get(sessionId);
    if (session === undefined) {
      session = {
        sessionId,
        cwd: "",
        startMs: at,
        endMs: at,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        userPrompts: 0,
        toolCalls: [],
      };
      sessions.set(sessionId, session);
    }
    session.cwd ||= asString(record["cwd"]) ?? "";
    session.startMs = Math.min(session.startMs, at);
    session.endMs = Math.max(session.endMs, at);
    const blocks = asBlocks(message["content"]);

    if (record["type"] === "assistant") {
      // Every content block of one message repeats that message's usage.
      const usage = asObject(message["usage"]);
      const messageId = asString(message["id"]);
      if (usage !== undefined && (messageId === undefined || !countedMessages.has(messageId))) {
        if (messageId !== undefined) countedMessages.add(messageId);
        session.cachedInputTokens += tokenCount(usage["cache_read_input_tokens"]);
        session.cacheCreationTokens += tokenCount(usage["cache_creation_input_tokens"]);
      }
      for (const block of blocks) {
        const id = asString(block["id"]);
        const name = asString(block["name"]);
        if (block["type"] !== "tool_use" || id === undefined || name === undefined) continue;
        const input = asObject(block["input"]) ?? {};
        const filePath = asString(input["file_path"]) ?? asString(input["notebook_path"]);
        const range =
          input["offset"] === undefined && input["limit"] === undefined
            ? undefined
            : `${String(input["offset"] ?? "")}:${String(input["limit"] ?? "")}`;
        const call: ToolCall = {
          name,
          resultTokens: 0,
          ...(filePath === undefined ? {} : { filePath }),
          ...(range === undefined ? {} : { range }),
        };
        session.toolCalls.push(call);
        pendingResults.set(id, call);
      }
    } else if (record["type"] === "user") {
      const results = blocks.filter((block) => block["type"] === "tool_result");
      for (const result of results) {
        const call = pendingResults.get(asString(result["tool_use_id"]) ?? "");
        if (call !== undefined) call.resultTokens += textTokens(result["content"]);
      }
      const typed =
        typeof message["content"] === "string" || blocks.some((block) => block["type"] === "text");
      if (
        typed &&
        results.length === 0 &&
        record["isMeta"] !== true &&
        record["isSidechain"] !== true
      )
        session.userPrompts += 1;
    }
  };

  return { add, sessions: (): ReadonlyArray<SessionActivity> => [...sessions.values()] };
};
