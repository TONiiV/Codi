import { STATUS_LABEL } from "../mock/providers";
import {
  agentsFor,
  personaList,
  selectPersona,
  setPalette,
  setSection,
  useApp,
  type Section,
} from "../store/app";
import {
  IconAgents,
  IconCalendar,
  IconProjects,
  IconSpark,
  IconToday,
} from "../ui/icons";
import { cx } from "../ui/primitives";

const NAV: Array<{ id: Section; label: string; latin: string; Icon: typeof IconToday }> = [
  { id: "today", label: "今天", latin: "TODAY", Icon: IconToday },
  { id: "agents", label: "智能体", latin: "AGENTS", Icon: IconAgents },
  { id: "projects", label: "项目", latin: "PROJECTS", Icon: IconProjects },
  { id: "calendar", label: "日历", latin: "CALENDAR", Icon: IconCalendar },
];

function PersonaRow({ personaId }: { personaId: string }) {
  const persona = personaList.find((p) => p.id === personaId)!;
  const active = useApp((s) => s.personaId === personaId);
  const busy = useApp(
    (s) => agentsFor(s, personaId).filter((a) => a.status !== "idle").length,
  );

  return (
    <button
      type="button"
      onClick={() => selectPersona(personaId)}
      className={cx(
        "group flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left transition-colors",
        active ? "bg-shell-2" : "hover:bg-shell-2/60",
      )}
    >
      <span
        className={cx(
          "inline-flex size-[26px] shrink-0 items-center justify-center rounded-[7px] text-[12px] font-medium transition-colors",
          active
            ? "bg-shell-ink text-shell"
            : "border border-shell-rule text-shell-muted group-hover:text-shell-ink",
        )}
      >
        {persona.glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cx(
            "block truncate text-[13.5px] leading-tight",
            active ? "font-medium text-shell-ink" : "text-shell-ink/72",
          )}
        >
          {persona.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-shell-muted">{persona.title}</span>
      </span>
      {busy > 0 ? (
        <span className="num shrink-0 text-[11px] text-shell-muted tabular-nums">{busy}</span>
      ) : null}
    </button>
  );
}

function NavRow({ item }: { item: (typeof NAV)[number] }) {
  const active = useApp((s) => s.section === item.id);
  return (
    <button
      type="button"
      onClick={() => setSection(item.id)}
      className={cx(
        "flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left transition-colors",
        active ? "bg-shell-2 text-shell-ink" : "text-shell-ink/62 hover:bg-shell-2/60",
      )}
    >
      <item.Icon className={cx("size-[17px] shrink-0", active ? "text-shell-ink" : "text-shell-muted")} />
      <span className={cx("flex-1 text-[13.5px]", active && "font-medium")}>{item.label}</span>
      {active ? <span className="eyebrow text-shell-muted">{item.latin}</span> : null}
    </button>
  );
}

export function Sidebar() {
  const persona = useApp((s) => personaList.find((p) => p.id === s.personaId)!);
  const busiest = useApp((s) => {
    const active = agentsFor(s, s.personaId).find((a) => a.status !== "idle");
    return active ? `${active.name} · ${STATUS_LABEL[active.status]}` : "全部空闲";
  });

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col bg-shell">
      <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
        <span className="inline-flex size-[26px] items-center justify-center rounded-[7px] bg-shell-ink">
          <span className="size-[10px] rounded-[2px] bg-shell" />
        </span>
        <span className="eyebrow text-shell-ink">CODI</span>
        <span className="eyebrow ml-auto text-shell-muted">OS</span>
      </div>

      <div className="px-3">
        <div className="eyebrow px-2.5 pb-2 text-shell-muted">人物主页</div>
        <div className="space-y-0.5">
          {personaList.map((p) => (
            <PersonaRow key={p.id} personaId={p.id} />
          ))}
        </div>
      </div>

      <div className="mt-7 px-3">
        <div className="eyebrow px-2.5 pb-2 text-shell-muted">工作台</div>
        <div className="space-y-0.5">
          {NAV.map((item) => (
            <NavRow key={item.id} item={item} />
          ))}
        </div>
      </div>

      <div className="mt-auto px-3 pb-3">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex w-full items-center gap-3 rounded-[9px] border border-shell-rule px-2.5 py-2.5 text-left transition-colors hover:bg-shell-2"
        >
          <IconSpark className="size-[17px] shrink-0 text-shell-ink" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-shell-ink">AI 助手</span>
            <span className="mt-0.5 block truncate text-[11px] text-shell-muted">{busiest}</span>
          </span>
          <kbd className="eyebrow rounded border border-shell-rule px-1.5 py-1 text-shell-muted">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="border-t border-shell-rule px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-[26px] items-center justify-center rounded-full border border-shell-rule text-[11px] text-shell-ink">
            {persona.glyph}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-shell-ink">{persona.name}</span>
            <span className="eyebrow mt-1 block text-shell-muted">{persona.latin}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
