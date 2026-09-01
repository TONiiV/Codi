/**
 * Shapes for every fixture in `src/mock/`. Nothing here crosses a network —
 * the prototype is a pure in-memory world seeded from these files.
 */

export type ProviderId = "claude" | "codex" | "cursor" | "grok" | "opencode";

export type Provider = {
  id: ProviderId;
  /** Chinese-facing label. */
  label: string;
  /** All-caps latin eyebrow used next to speaker names. */
  latin: string;
  models: string[];
};

export type AgentStatus = "idle" | "thinking" | "tool" | "review" | "blocked";

export type Agent = {
  id: string;
  personaId: string;
  name: string;
  /** Single glyph shown in the square avatar. */
  glyph: string;
  /** Latin transliteration, used as an eyebrow. */
  latin: string;
  role: string;
  teamId: string;
  provider: ProviderId;
  model: string;
  status: AgentStatus;
  /** One-line description of what the agent is doing right now. */
  activity: string;
};

export type Team = {
  id: string;
  personaId: string;
  name: string;
  latin: string;
};

export type Persona = {
  id: string;
  name: string;
  glyph: string;
  latin: string;
  title: string;
  /** Serif pull-quote shown on the persona home hero. */
  motto: string;
  greeting: string;
  /** Subtitle under the persona home headline. */
  brief: string;
};

export type ToolCall = {
  id: string;
  kind: "read" | "edit" | "bash" | "search" | "test";
  title: string;
  target: string;
  /** Monospace lines revealed when the block is expanded. */
  output: string[];
  status: "done" | "running";
};

export type DiffLine = { type: "add" | "del" | "ctx"; text: string };

export type DiffCard = {
  file: string;
  added: number;
  removed: number;
  hunk: string;
  lines: DiffLine[];
};

export type Message = {
  id: string;
  threadId: string;
  /** Agent id, or `"user"` for the human. */
  authorId: string;
  /** `"join"` renders a transcript rule instead of a speaker block. */
  kind?: "join";
  /** Set when this message was triggered by another agent's @-mention. */
  replyToId?: string;
  text: string;
  time: string;
  toolCalls?: ToolCall[];
  diff?: DiffCard;
  streaming?: boolean;
};

export type Thread = {
  id: string;
  personaId: string;
  projectId: string;
  title: string;
  latin: string;
  /** Agents that have spoken in, or are watching, this thread. */
  participantIds: string[];
};

export type DecisionState = "chosen" | "rejected" | "open";

export type DecisionNode = {
  id: string;
  title: string;
  detail: string;
  state: DecisionState;
  /** Who drove the call, and when. */
  owner?: string;
  when?: string;
  children?: DecisionNode[];
};

export type Milestone = {
  id: string;
  date: string;
  title: string;
  detail: string;
  state: "done" | "active" | "future";
};

export type RoadmapPhase = {
  id: string;
  label: string;
  latin: string;
  span: string;
  progress: number;
  state: "done" | "active" | "future";
};

export type LiveAgentWork = {
  agentId: string;
  task: string;
  /** Minutes elapsed at fixture time; the UI ticks it forward while mounted. */
  elapsedMin: number;
  tokens: number;
  burnPerMin: number;
};

export type Project = {
  id: string;
  personaId: string;
  name: string;
  latin: string;
  summary: string;
  progress: number;
  health: "on-track" | "at-risk" | "blocked";
  live: LiveAgentWork[];
  roadmap: RoadmapPhase[];
  milestones: Milestone[];
  decisions: DecisionNode;
};

export type TodoLabel = "研发" | "设计" | "评审" | "发布" | "调研";

export type Todo = {
  id: string;
  personaId: string;
  projectId: string;
  title: string;
  label: TodoLabel;
  agentId: string;
  /** Hours from "now" at app boot. Negative means already started. */
  startH: number;
  durH: number;
  state: "todo" | "doing" | "done";
};

export type CaptureTab = {
  id: string;
  label: string;
  placeholder: string;
};

export type CaptureNote = {
  id: string;
  tabId: string;
  text: string;
  time: string;
};
