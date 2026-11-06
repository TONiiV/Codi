import type { SessionActivity, ToolCall } from "./claudeSessions.ts";

const at = (minute: number) => `2026-11-02T09:${String(minute).padStart(2, "0")}:00.000Z`;

/** Claude Code transcript lines in the shape it writes them. */
export const transcript = {
  prompt: (sessionId: string, minute: number, text: string, fields: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "user",
      sessionId,
      cwd: "/repo",
      timestamp: at(minute),
      message: { role: "user", content: text },
      ...fields,
    }),
  toolUse: (
    sessionId: string,
    minute: number,
    messageId: string,
    id: string,
    name: string,
    input: Record<string, unknown>,
    usage = { cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 },
  ) =>
    JSON.stringify({
      type: "assistant",
      sessionId,
      cwd: "/repo",
      timestamp: at(minute),
      message: {
        id: messageId,
        model: "claude-test",
        usage,
        content: [{ type: "tool_use", id, name, input }],
      },
    }),
  toolResult: (sessionId: string, minute: number, id: string, chars: number, plain = false) =>
    JSON.stringify({
      type: "user",
      sessionId,
      cwd: "/repo",
      timestamp: at(minute),
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: plain ? "x".repeat(chars) : [{ type: "text", text: "x".repeat(chars) }],
          },
        ],
      },
    }),
};

export const session = (
  sessionId: string,
  overrides: Partial<Omit<SessionActivity, "toolCalls">> & { toolCalls?: ToolCall[] } = {},
): SessionActivity => ({
  sessionId,
  cwd: "/repo",
  startMs: 1_000,
  endMs: 2_000,
  cachedInputTokens: 950_000,
  cacheCreationTokens: 50_000,
  turns: 20,
  userPrompts: 1,
  toolCalls: [],
  ...overrides,
});
