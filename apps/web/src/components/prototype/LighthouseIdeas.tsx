// PROTOTYPE, wipe me. Ideas: a scratchpad on a dot-grid canvas. Ideas look like a checklist but
// are not one: selected ideas go to an agent that files each as a task in its project; ideas with
// no project stay. Pasted or dropped files snap to the grid and ideas can link to them.
// In memory only; pasted files are object URLs for this session.
import {
  CheckIcon,
  FileIcon,
  LinkIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { createTaskIn, useViewer } from "./lighthouseActions";
import {
  PROJECTS,
  chiefName,
  chiefProjects,
  projectsIn,
  type LighthouseViewer,
} from "./lighthouseData";
import { useLighthouseSearch } from "./lighthouseLocation";
import { useWorkspaceId } from "./workspaceStore";

const GRID = 24;
const CANVAS = { w: 2400, h: 1600 };
const LIST_W = 336;
const HEADER_H = 48;
const ROW_H = 40;
const CARD_W = 240;

interface Idea {
  id: string;
  text: string;
  /** An agent tried to file it and found no matching project, so it stayed here. */
  unsorted: boolean;
  link: string | null;
}

interface Card {
  id: string;
  kind: "image" | "file";
  name: string;
  size: number;
  url: string | null;
  x: number;
  y: number;
}

interface Board {
  ideas: ReadonlyArray<Idea>;
  cards: ReadonlyArray<Card>;
  list: { x: number; y: number };
}

/** The open canvas's board is spread on the state; the other canvases wait in `parked`. */
interface IdeasState extends Board {
  canvases: ReadonlyArray<{ id: string; name: string }>;
  current: string;
  parked: Readonly<Record<string, Board>>;
  seq: number;
}

const SKETCH = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="#f6f6f4"/><rect x="24" y="24" width="120" height="252" rx="10" fill="#e4e4e0"/><rect x="164" y="24" width="292" height="40" rx="10" fill="#dcdcd6"/><rect x="164" y="84" width="140" height="92" rx="10" fill="#cfd8ff"/><rect x="316" y="84" width="140" height="92" rx="10" fill="#e4e4e0"/><rect x="164" y="196" width="292" height="80" rx="10" fill="#e4e4e0"/><circle cx="234" cy="130" r="22" fill="#3b5bdb"/></svg>`,
)}`;

let state: IdeasState = {
  ideas: [
    {
      id: "i1",
      text: "Ideas 里的一条想法，一键交给个人助理展开成任务",
      unsorted: false,
      link: null,
    },
    { id: "i2", text: "Dashboard 第一屏改成卡片网格，参考这张草图", unsorted: false, link: "c1" },
    { id: "i3", text: "竞品的定价分层值得抄一下", unsorted: false, link: "c2" },
    { id: "i4", text: "Telegram 语音消息直接转成想法", unsorted: false, link: null },
  ],
  cards: [
    {
      id: "c1",
      kind: "image",
      name: "dashboard-草图.png",
      size: 182_000,
      url: SKETCH,
      x: 480,
      y: 72,
    },
    {
      id: "c2",
      kind: "file",
      name: "竞品定价对比.pdf",
      size: 1_240_000,
      url: null,
      x: 480,
      y: 384,
    },
  ],
  list: { x: 48, y: 72 },
  canvases: [{ id: "k1", name: "我的画布" }],
  current: "k1",
  parked: {},
  seq: 10,
};
const listeners = new Set<() => void>();
const commit = (patch: Partial<IdeasState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const useIdeas = () => useSyncExternalStore(subscribe, () => state);

export function useCanvases() {
  const { canvases, current } = useIdeas();
  return { canvases, current };
}

const EMPTY: Board = { ideas: [], cards: [], list: { x: 48, y: 72 } };
const board = (s: IdeasState): Board => ({ ideas: s.ideas, cards: s.cards, list: s.list });

export function switchCanvas(id: string) {
  if (id === state.current) return;
  const parked = { ...state.parked, [state.current]: board(state) };
  const next = parked[id] ?? EMPTY;
  delete parked[id];
  commit({ ...next, parked, current: id });
}

export function addCanvas() {
  const id = `k${state.seq + 1}`;
  commit({
    seq: state.seq + 1,
    canvases: [...state.canvases, { id, name: `画布 ${state.canvases.length + 1}` }],
  });
  switchCanvas(id);
}

export function removeCanvas(id: string) {
  if (state.canvases.length < 2) return;
  const gone = id === state.current ? board(state) : state.parked[id];
  for (const c of gone?.cards ?? []) if (c.url?.startsWith("blob:")) URL.revokeObjectURL(c.url);
  const canvases = state.canvases.filter((c) => c.id !== id);
  if (id === state.current) switchCanvas(canvases[0]!.id);
  const { [id]: _dropped, ...parked } = state.parked;
  commit({ canvases, parked });
}

const snap = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v / GRID) * GRID));
const nextId = (prefix: string) => {
  commit({ seq: state.seq + 1 });
  return `${prefix}${state.seq}`;
};

function addIdea(text: string) {
  const clean = text.trim();
  if (!clean) return;
  commit({
    ideas: [...state.ideas, { id: nextId("i"), text: clean, unsorted: false, link: null }],
  });
}

const patchIdea = (id: string, patch: Partial<Idea>) =>
  commit({ ideas: state.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

const cardHeight = (c: Pick<Card, "kind">) => (c.kind === "image" ? 300 : 144);

/** The first grid slot, row by row inside the visible width, where a card of this kind overlaps nothing. */
function freeSlot(
  kind: Card["kind"],
  from: { x: number; y: number; w: number },
  taken: ReadonlyArray<Card>,
) {
  const h = cardHeight({ kind });
  const hits = (x: number, y: number) =>
    taken.some(
      (c) =>
        x < c.x + CARD_W + GRID &&
        c.x < x + CARD_W + GRID &&
        y < c.y + cardHeight(c) &&
        c.y < y + h,
    ) ||
    (x < state.list.x + LIST_W + GRID && state.list.x < x + CARD_W && y < state.list.y + 480);
  for (let y = snap(from.y, CANVAS.h); y < CANVAS.h - h; y += GRID * 2)
    for (
      let x = snap(from.x, CANVAS.w);
      x <= Math.min(CANVAS.w, from.x + from.w) - CARD_W;
      x += GRID * 2
    )
      if (!hits(x, y)) return { x, y };
  return { x: snap(from.x, CANVAS.w - CARD_W), y: snap(from.y, CANVAS.h - h) };
}

function addFiles(
  files: ReadonlyArray<File>,
  at: { x: number; y: number; w: number },
  exact = false,
) {
  const added: Array<Card> = [];
  for (const [n, file] of files.entries()) {
    const image = file.type.startsWith("image/");
    const kind = image ? ("image" as const) : ("file" as const);
    const spot = exact
      ? {
          x: snap(at.x + n * GRID, CANVAS.w - CARD_W),
          y: snap(at.y + n * GRID, CANVAS.h - GRID * 4),
        }
      : freeSlot(kind, at, [...state.cards, ...added]);
    added.push({
      id: nextId("c"),
      kind,
      name: file.name || (image ? "截图.png" : "文件"),
      size: file.size,
      url: image ? URL.createObjectURL(file) : null,
      ...spot,
    });
  }
  commit({ cards: [...state.cards, ...added] });
}

function removeCard(id: string) {
  const card = state.cards.find((c) => c.id === id);
  if (card?.url?.startsWith("blob:")) URL.revokeObjectURL(card.url);
  commit({
    cards: state.cards.filter((c) => c.id !== id),
    ideas: state.ideas.map((i) => (i.link === id ? { ...i, link: null } : i)),
  });
}

// Stand-in for the agent's content recognition: keywords in the idea and its linked file name.
const TOPICS: Record<string, ReadonlyArray<string>> = {
  codi: ["Codi", "Ideas", "ideas", "Chief", "Telegram", "Dashboard", "画布", "agent", "个人助理"],
  site: ["官网", "定价", "博客", "RSS", "SEO"],
  app: ["移动端", "手机", "App", "iOS", "Android"],
  docs: ["文档", "API 参考"],
  ops: ["运维", "服务器", "部署", "监控"],
};

function classify(idea: Idea, open: ReadonlyArray<string>): string | null {
  const card = state.cards.find((c) => c.id === idea.link);
  const text = `${idea.text} ${card?.name ?? ""}`;
  return open.find((p) => TOPICS[p]?.some((word) => text.includes(word))) ?? null;
}

function sendToAgent(agent: string, ids: ReadonlyArray<string>, open: ReadonlyArray<string>) {
  const filed: Record<string, number> = {};
  const kept = new Set<string>();
  for (const idea of state.ideas.filter((i) => ids.includes(i.id))) {
    const project = classify(idea, open);
    if (!project) {
      kept.add(idea.id);
      continue;
    }
    const card = state.cards.find((c) => c.id === idea.link);
    createTaskIn(project, idea.text, card ? `来自 Ideas，附件：${card.name}` : "来自 Ideas");
    filed[project] = (filed[project] ?? 0) + 1;
  }
  commit({
    ideas: state.ideas
      .filter((i) => !ids.includes(i.id) || kept.has(i.id))
      .map((i) => (kept.has(i.id) ? { ...i, unsorted: true } : i)),
  });
  const done = Object.entries(filed)
    .map(([p, n]) => `${PROJECTS[p]?.name ?? p} ${n} 条`)
    .join("，");
  toastManager.add({
    type: done ? "success" : "info",
    title: done ? `${agent} 已把想法归进任务：${done}` : `${agent} 没找到对应的项目`,
    description:
      kept.size > 0
        ? `${kept.size} 条没找到对应项目，留在 Ideas 里。`
        : "这些条目已从 Ideas 移走。",
  });
}

const formatSize = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`;

/** Drag by pointer; positions follow the pointer freely and snap to the grid on release. */
function useDrag(
  pos: { x: number; y: number },
  move: (x: number, y: number) => void,
  maxX: number,
) {
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const at = (e: ReactPointerEvent, done: boolean) => {
    const s = start.current;
    if (!s) return;
    const x = s.x + e.clientX - s.px;
    const y = s.y + e.clientY - s.py;
    move(done ? snap(x, maxX) : x, done ? snap(y, CANVAS.h - GRID * 4) : y);
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      // Portaled menus bubble through React to here; only drag from this element itself.
      if (e.button !== 0 || !e.currentTarget.contains(target) || target.closest("button,input"))
        return;
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    },
    onPointerMove: (e: ReactPointerEvent) => at(e, false),
    onPointerUp: (e: ReactPointerEvent) => {
      at(e, true);
      start.current = null;
    },
  };
}

function SendToAgent({ ids, onSent }: { ids: ReadonlyArray<string>; onSent: () => void }) {
  const viewer: LighthouseViewer = useLighthouseSearch()?.as ?? "admin";
  const workspace = useWorkspaceId();
  const me = useViewer(viewer);
  const open = projectsIn(workspace, viewer).open;
  const chiefs = chiefProjects(workspace, viewer).map((p) => chiefName(viewer, p));
  const send = (agent: string) => {
    sendToAgent(agent, ids, open);
    onSent();
  };
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="xs" variant="default">
            <SendIcon />
            发送给 agent
          </Button>
        }
      />
      <MenuPopup align="end" sideOffset={6}>
        <MenuGroup>
          <MenuGroupLabel>识别内容，归类成对应项目的任务</MenuGroupLabel>
          <MenuItem onClick={() => send(me.cos.name)}>{me.cos.name}（个人助理）</MenuItem>
          {chiefs.map((name) => (
            <MenuItem key={name} onClick={() => send(name)}>
              {name}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function IdeaList({
  linking,
  onLink,
}: {
  linking: string | null;
  onLink: (id: string | null) => void;
}) {
  const { ideas, cards, list } = useIdeas();
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useDrag(list, (x, y) => commit({ list: { x, y } }), CANVAS.w - LIST_W);
  const selected = picked.filter((id) => ideas.some((i) => i.id === id));
  const save = () => {
    if (draft !== null) addIdea(draft);
    setDraft(null);
  };
  return (
    <section
      aria-label="想法"
      style={{ left: list.x, top: list.y, width: LIST_W }}
      className="absolute flex flex-col rounded-xl border bg-card shadow-lg"
    >
      <header
        {...drag}
        style={{ height: HEADER_H }}
        className="flex cursor-grab touch-none items-center gap-2 border-b px-3 select-none active:cursor-grabbing"
      >
        <SparklesIcon className="size-4 text-foreground" />
        <span className="font-medium">想法</span>
        <span className="text-xs text-muted-foreground tabular-nums">{ideas.length}</span>
        {selected.length > 0 ? (
          <span className="ms-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground tabular-nums">
              已选 {selected.length}
            </span>
            <SendToAgent ids={selected} onSent={() => setPicked([])} />
          </span>
        ) : null}
      </header>
      <ul>
        {ideas.map((idea) => {
          const card = cards.find((c) => c.id === idea.link);
          const on = selected.includes(idea.id);
          return (
            <li
              key={idea.id}
              style={{ height: ROW_H }}
              className={cn(
                "group/idea flex items-center gap-2 px-3",
                (on || linking === idea.id) && "bg-primary/8",
              )}
            >
              <button
                type="button"
                aria-pressed={on}
                aria-label={`选中「${idea.text}」`}
                onClick={() =>
                  setPicked(on ? selected.filter((id) => id !== idea.id) : [...selected, idea.id])
                }
                className={cn(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  on && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {on ? <CheckIcon className="size-3" /> : null}
              </button>
              <span className="min-w-0 flex-1 truncate text-sm">{idea.text}</span>
              {idea.unsorted ? (
                <span className="shrink-0 rounded-md bg-warning/12 px-1.5 py-0.5 text-2xs text-warning-foreground">
                  没找到项目
                </span>
              ) : null}
              {card ? (
                <span className="inline-flex max-w-28 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                  {card.kind === "image" ? (
                    <img src={card.url ?? ""} alt="" className="size-3.5 rounded-sm object-cover" />
                  ) : (
                    <FileIcon className="size-3" />
                  )}
                  <span className="truncate">{card.name}</span>
                  <button
                    type="button"
                    aria-label={`取消链接 ${card.name}`}
                    onClick={() => patchIdea(idea.id, { link: null })}
                    className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ) : (
                <span
                  className={cn(
                    "shrink-0",
                    linking !== idea.id &&
                      "opacity-0 group-hover/idea:opacity-100 has-focus-visible:opacity-100",
                  )}
                >
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`链接「${idea.text}」到文件或图片`}
                    aria-pressed={linking === idea.id}
                    onClick={() => onLink(linking === idea.id ? null : idea.id)}
                  >
                    <LinkIcon />
                  </Button>
                </span>
              )}
            </li>
          );
        })}
        {draft !== null ? (
          <li style={{ height: ROW_H }} className="flex items-center gap-2 px-3">
            <span className="size-4 shrink-0 rounded-full border border-dashed" />
            <Input
              size="sm"
              ref={(el) => el?.focus()}
              value={draft}
              aria-label="新想法"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setDraft(null);
              }}
            />
          </li>
        ) : null}
      </ul>
      <div className="border-t p-1.5">
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-label="添加想法"
          onClick={() => setDraft("")}
        >
          <PlusIcon />
        </Button>
      </div>
    </section>
  );
}

function CanvasCard({
  card,
  linking,
  onPick,
}: {
  card: Card;
  linking: boolean;
  onPick: () => void;
}) {
  const { ideas } = useIdeas();
  const linked = ideas.filter((i) => i.link === card.id);
  const drag = useDrag(
    card,
    (x, y) => commit({ cards: state.cards.map((c) => (c.id === card.id ? { ...c, x, y } : c)) }),
    CANVAS.w - CARD_W,
  );
  return (
    <figure
      {...(linking ? {} : drag)}
      onClick={linking ? onPick : undefined}
      style={{ left: card.x, top: card.y, width: CARD_W }}
      className={cn(
        "group/card absolute m-0 flex touch-none flex-col overflow-hidden rounded-xl border bg-card shadow-md select-none motion-safe:animate-ideas-snap",
        linking
          ? "cursor-pointer ring-2 ring-primary/40 hover:ring-primary"
          : "cursor-grab active:cursor-grabbing",
      )}
    >
      {card.kind === "image" && card.url ? (
        <img
          src={card.url}
          alt={card.name}
          draggable={false}
          className="max-h-60 w-full bg-muted object-cover"
        />
      ) : (
        <div className="flex h-16 items-center justify-center bg-muted">
          <FileIcon className="size-7 text-muted-foreground" />
        </div>
      )}
      <figcaption className="flex items-center gap-2 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium">{card.name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{formatSize(card.size)}</span>
      </figcaption>
      {linked.length > 0 ? (
        <span className="border-t px-3 py-1.5 text-2xs text-muted-foreground">
          链接自 {linked.length} 条想法
        </span>
      ) : null}
      <span className="absolute end-1.5 top-1.5 opacity-0 group-hover/card:opacity-100 has-focus-visible:opacity-100">
        <Button
          size="icon-xs"
          variant="secondary"
          aria-label={`从画布移除 ${card.name}`}
          onClick={() => removeCard(card.id)}
        >
          <XIcon />
        </Button>
      </span>
    </figure>
  );
}

/** Curves from each linked idea's row to the left or right edge of its card. */
function Links() {
  const { ideas, cards, list } = useIdeas();
  return (
    <svg
      aria-hidden="true"
      width={CANVAS.w}
      height={CANVAS.h}
      className="pointer-events-none absolute inset-0 text-primary"
    >
      {ideas.map((idea, i) => {
        const card = cards.find((c) => c.id === idea.link);
        if (!card) return null;
        const y1 = list.y + HEADER_H + i * ROW_H + ROW_H / 2;
        const y2 = card.y + 28;
        // Beside the list: curve straight across. Under or over it: loop round its right side.
        const left = card.x + CARD_W <= list.x;
        const across = left || card.x >= list.x + LIST_W;
        const x1 = left ? list.x : list.x + LIST_W;
        const x2 = left || !across ? card.x + CARD_W : card.x;
        const bend = Math.max(48, Math.abs(x2 - x1) / 2);
        const d = across
          ? `M${x1} ${y1} C${x1 + (left ? -bend : bend)} ${y1} ${x2 + (left ? bend : -bend)} ${y2} ${x2} ${y2}`
          : `M${x1} ${y1} C${Math.max(x1, x2) + 72} ${y1} ${Math.max(x1, x2) + 72} ${y2} ${x2} ${y2}`;
        return (
          <g key={idea.id}>
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              opacity={0.7}
            />
            <circle cx={x1} cy={y1} r={3} fill="currentColor" />
            <circle cx={x2} cy={y2} r={3} fill="currentColor" />
          </g>
        );
      })}
    </svg>
  );
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.closest("input,textarea") !== null);

function IdeasBoard() {
  const { cards, ideas } = useIdeas();
  const [linking, setLinking] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const linkingIdea = ideas.find((i) => i.id === linking);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clipboard and Esc are document events
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      const el = scroller.current;
      if (files.length > 0 && el) {
        e.preventDefault();
        addFiles(files, {
          x: el.scrollLeft + GRID * 2,
          y: el.scrollTop + GRID * 3,
          w: el.clientWidth - GRID * 3,
        });
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!isEditable(e.target) && text.trim()) {
        e.preventDefault();
        addIdea(text);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLinking(null);
    };
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
        <p
          role="status"
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm",
            linkingIdea
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-popover text-muted-foreground",
          )}
        >
          {linkingIdea ? (
            <>点画布上的一个文件或图片，链接到「{linkingIdea.text}」。按 Esc 取消。</>
          ) : (
            <>
              Ctrl+V 粘贴截图或文件，或者直接拖进来，它们会吸附到网格上。粘贴文字会记成一条新想法。
            </>
          )}
        </p>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div
          role="application"
          aria-label="想法画布"
          className="relative"
          style={{
            width: CANVAS.w,
            height: CANVAS.h,
            backgroundImage:
              "radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--muted-foreground) 45%, transparent) 1.2px, transparent 1.7px)",
            backgroundSize: `${GRID}px ${GRID}px`,
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            const files = [...e.dataTransfer.files];
            if (files.length > 0)
              addFiles(
                files,
                { x: e.clientX - box.left - CARD_W / 2, y: e.clientY - box.top - 24, w: CARD_W },
                true,
              );
          }}
        >
          <Links />
          {cards.map((card) => (
            <CanvasCard
              key={card.id}
              card={card}
              linking={linking !== null}
              onPick={() => {
                if (linking) patchIdea(linking, { link: card.id });
                setLinking(null);
              }}
            />
          ))}
          <IdeaList linking={linking} onLink={setLinking} />
        </div>
      </div>
    </div>
  );
}

export function IdeasPage() {
  const { current } = useCanvases();
  return <IdeasBoard key={current} />;
}
