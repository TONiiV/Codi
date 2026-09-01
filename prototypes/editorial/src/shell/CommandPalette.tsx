import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABEL } from "../mock/providers";
import {
  agentsFor,
  getState,
  personaList,
  projectsFor,
  selectAgent,
  selectPersona,
  selectProject,
  setPalette,
  setSection,
  todosFor,
  useApp,
} from "../store/app";
import { cx } from "../ui/primitives";

type Entry = {
  id: string;
  group: string;
  title: string;
  meta: string;
  run: () => void;
};

function buildEntries(): Entry[] {
  const state = getState();
  const entries: Entry[] = [];

  personaList.forEach((persona) => {
    entries.push({
      id: `p:${persona.id}`,
      group: "人物主页",
      title: persona.name,
      meta: persona.title,
      run: () => {
        selectPersona(persona.id);
        setSection("today");
      },
    });
  });

  (
    [
      ["today", "今天"],
      ["agents", "智能体"],
      ["projects", "项目"],
      ["calendar", "日历"],
    ] as const
  ).forEach(([id, label]) => {
    entries.push({
      id: `s:${id}`,
      group: "版块",
      title: label,
      meta: "切换到该版块",
      run: () => setSection(id),
    });
  });

  agentsFor(state, state.personaId).forEach((agent) => {
    entries.push({
      id: `a:${agent.id}`,
      group: "智能体",
      title: agent.name,
      meta: `${agent.role} · ${STATUS_LABEL[agent.status]}`,
      run: () => {
        setSection("agents");
        selectAgent(agent.id);
      },
    });
  });

  projectsFor(state.personaId).forEach((project) => {
    entries.push({
      id: `pr:${project.id}`,
      group: "项目",
      title: project.name,
      meta: `完成度 ${project.progress}%`,
      run: () => {
        setSection("projects");
        selectProject(project.id);
      },
    });
  });

  todosFor(state.personaId)
    .filter((todo) => todo.state !== "done")
    .slice(0, 12)
    .forEach((todo) => {
      entries.push({
        id: `td:${todo.id}`,
        group: "待办",
        title: todo.title,
        meta: todo.label,
        run: () => setSection("calendar"),
      });
    });

  return entries;
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const personaId = useApp((s) => s.personaId);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(!getState().paletteOpen);
      }
      if (event.key === "Escape" && getState().paletteOpen) setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();
  }, [open]);

  const entries = useMemo(() => (open ? buildEntries() : []), [open, personaId]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 14);
    return entries
      .filter(
        (entry) =>
          entry.title.toLowerCase().includes(q) ||
          entry.meta.toLowerCase().includes(q) ||
          entry.group.includes(q),
      )
      .slice(0, 14);
  }, [entries, query]);

  if (!open) return null;

  const commit = (entry: Entry | undefined) => {
    if (!entry) return;
    entry.run();
    setPalette(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-shell/28 px-6 pt-[14vh]"
      onMouseDown={() => setPalette(false)}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[16px] border border-rule bg-card shadow-[0_24px_60px_-24px_rgba(22,19,15,0.35)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-rule px-5 py-4">
          <div className="eyebrow text-faint">COMMAND</div>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                commit(results[cursor]);
              }
            }}
            placeholder="去哪里？"
            className="mt-2 w-full bg-transparent text-[19px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-faint"
          />
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-muted">没有匹配的结果</div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => commit(entry)}
                className={cx(
                  "flex w-full items-baseline gap-3 px-5 py-2.5 text-left",
                  index === cursor && "bg-paper-sunk",
                )}
              >
                <span className="eyebrow w-[52px] shrink-0 text-faint">{entry.group}</span>
                <span className="flex-1 truncate text-[14px] text-ink">{entry.title}</span>
                <span className="shrink-0 text-[12px] text-muted">{entry.meta}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
