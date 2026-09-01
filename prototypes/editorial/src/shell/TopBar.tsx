import { personaById, setPalette, useApp } from "../store/app";
import { IconSearch } from "../ui/icons";

const SECTION_LABEL: Record<string, string> = {
  today: "今天",
  agents: "智能体",
  projects: "项目",
  calendar: "日历",
};

function todayLabel() {
  const now = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${week}`;
}

export function TopBar() {
  const personaName = useApp((s) => personaById(s.personaId).name);
  const section = useApp((s) => s.section);

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-6 border-b border-rule px-8">
      <div className="flex min-w-0 shrink-0 items-center gap-2 text-[12.5px]">
        <span className="text-muted">{personaName}</span>
        <span className="text-faint">/</span>
        <span className="font-medium text-ink">{SECTION_LABEL[section]}</span>
      </div>

      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-9 w-full max-w-[420px] items-center gap-2.5 rounded-full border border-rule bg-card px-4 text-left transition-colors hover:border-rule-strong"
        >
          <IconSearch className="size-4 shrink-0 text-faint" />
          <span className="flex-1 text-[13px] text-muted">搜索人物、智能体、项目与待办</span>
          <kbd className="eyebrow rounded border border-rule px-1.5 py-1 text-faint">⌘K</kbd>
        </button>
      </div>

      <div className="shrink-0 text-[12.5px] text-muted tabular-nums">{todayLabel()}</div>
    </header>
  );
}
