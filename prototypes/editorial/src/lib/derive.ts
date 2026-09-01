import type { DecisionNode, DecisionState, Project, Todo } from "../mock/types";
import { BOOT_TIME } from "../store/app";

export function countDecisions(root: DecisionNode): Record<DecisionState, number> {
  const totals: Record<DecisionState, number> = { chosen: 0, rejected: 0, open: 0 };
  const walk = (node: DecisionNode) => {
    totals[node.state] += 1;
    node.children?.forEach(walk);
  };
  walk(root);
  return totals;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

export function formatElapsed(minutes: number): string {
  const whole = Math.floor(minutes);
  if (whole < 60) return `${whole} 分钟`;
  return `${Math.floor(whole / 60)} 小时 ${whole % 60} 分`;
}

export function hoursFromNow(todo: Todo): number {
  return todo.startH - (Date.now() - BOOT_TIME) / 3_600_000;
}

export function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** `0` = today, `1` = tomorrow, and so on, relative to boot. */
export function dayOffset(date: Date): number {
  const base = new Date(BOOT_TIME);
  base.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

export function dayLabel(offset: number): string {
  if (offset === 0) return "今天";
  if (offset === 1) return "明天";
  if (offset === -1) return "昨天";
  const date = new Date(BOOT_TIME + offset * 86_400_000);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function projectBurn(project: Project): number {
  return project.live.reduce((total, work) => total + work.tokens, 0);
}
