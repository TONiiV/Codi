import type { AgentStatus, Provider, ProviderId } from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    latin: "CLAUDE CODE",
    models: ["claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5"],
  },
  codex: {
    id: "codex",
    label: "Codex",
    latin: "CODEX",
    models: ["gpt-5.2-codex", "gpt-5.2-codex-mini", "o4-mini"],
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    latin: "CURSOR",
    models: ["composer-1", "cheetah", "auto"],
  },
  grok: {
    id: "grok",
    label: "Grok",
    latin: "GROK",
    models: ["grok-4.1", "grok-code-fast-1"],
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    latin: "OPENCODE",
    models: ["kimi-k2-1120", "qwen3-coder-480b", "glm-4.6"],
  },
};

export const PROVIDER_ORDER: ProviderId[] = ["claude", "codex", "cursor", "grok", "opencode"];

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "空闲",
  thinking: "思考中",
  tool: "执行工具",
  review: "待评审",
  blocked: "已阻塞",
};

/**
 * Status colour is one of the few places colour is allowed. `idle` stays
 * grey on purpose so a quiet roster reads as quiet.
 */
export const STATUS_TONE: Record<AgentStatus, string> = {
  idle: "text-faint",
  thinking: "text-cool",
  tool: "text-live",
  review: "text-warn",
  blocked: "text-stop",
};
