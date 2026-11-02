// PROTOTYPE, wipe me. Agent IP mascots: vector rigs of the ip-as-logo art, moved the bloub way
// (github.com/jeremy-prt/bloub). Poses join by exponential ease-outs with no overshoot, the
// body never floats, and face parts sit on a sphere so a head turn slides and foreshortens
// them. Frames run only during a transition, blink, glance or a busy state.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "../../lib/utils";

export type MascotKind = "owl" | "otter" | "beaver" | "puffin" | "seal";
export type MascotState =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "done"
  | "blocked"
  | "sleeping";

export const MASCOT_STATES: ReadonlyArray<{ id: MascotState; label: string }> = [
  { id: "idle", label: "待命" },
  { id: "thinking", label: "思考" },
  { id: "working", label: "干活" },
  { id: "waiting", label: "等你" },
  { id: "done", label: "完成" },
  { id: "blocked", label: "卡住" },
  { id: "sleeping", label: "离线" },
];

type Face = "open" | "happy" | "sad" | "closed";
type Point = readonly [number, number];

interface Part {
  at: Point;
  node: ReactNode;
}

interface Rig {
  name: string;
  role: string;
  bg: string;
  head: { cx: number; cy: number; r: number };
  /** Ears and tufts: behind the head, they slide against the turn. */
  back: ReactNode;
  body: ReactNode;
  /** Face plates (discs, muzzles) and features, each anchored on the head sphere. */
  plates: ReadonlyArray<Part>;
  front: ReadonlyArray<Part>;
  eyes: { l: Point; r: Point; rx: number; ry: number; fill: string; ring?: string };
}

const OWL = { c1: "#C98A4B", c2: "#F6E7CC", ink: "#6E4521" };
const OTTER = { c1: "#7A5544", c2: "#F3E2C7", ink: "#3B2A22" };
const BEAVER = { c1: "#D9772E", c2: "#FBF1DC", ink: "#2E2219" };
const PUFFIN = { c1: "#2B2B2E", c2: "#E8893A" };
const SEAL = { c1: "#D9DEE3", c2: "#2F3338", shade: "#BEC6CE" };

export const MASCOTS: Record<MascotKind, Rig> = {
  owl: {
    name: "砚书",
    role: "私人幕僚长 · 猫头鹰，守夜，什么都看得见",
    bg: "#3F4A63",
    head: { cx: 32, cy: 33, r: 22 },
    back: (
      <>
        <ellipse
          cx="17.5"
          cy="17"
          rx="3.6"
          ry="6.5"
          fill={OWL.c1}
          transform="rotate(-28 17.5 17)"
        />
        <ellipse cx="46.5" cy="17" rx="3.6" ry="6.5" fill={OWL.c1} transform="rotate(28 46.5 17)" />
      </>
    ),
    body: (
      <>
        <ellipse cx="32" cy="38" rx="23" ry="25" fill={OWL.c1} />
        <ellipse cx="32" cy="57" rx="13" ry="10" fill={OWL.c2} />
      </>
    ),
    plates: [
      { at: [24, 31], node: <circle cx="24" cy="31" r="9.5" fill={OWL.c2} /> },
      { at: [40, 31], node: <circle cx="40" cy="31" r="9.5" fill={OWL.c2} /> },
    ],
    front: [
      {
        at: [32, 39],
        node: (
          <path
            d="M29.5 37.5 Q32 36 34.5 37.5 L32 41.5 Z"
            fill={OWL.c1}
            stroke={OWL.c1}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        ),
      },
    ],
    eyes: { l: [24, 31], r: [40, 31], rx: 3.3, ry: 4, fill: OWL.ink },
  },
  otter: {
    name: "项目幕僚长",
    role: "项目幕僚长 · 海獭，手牵手不让项目漂走",
    bg: "#5F9E99",
    head: { cx: 32, cy: 30, r: 19 },
    back: (
      <>
        <circle cx="17" cy="18" r="5" fill={OTTER.c1} />
        <circle cx="47" cy="18" r="5" fill={OTTER.c1} />
      </>
    ),
    body: (
      <>
        <ellipse cx="32" cy="58" rx="18" ry="15" fill={OTTER.c1} />
        <ellipse cx="32" cy="60" rx="10" ry="9" fill={OTTER.c2} />
        <ellipse cx="32" cy="30" rx="19.5" ry="17.5" fill={OTTER.c1} />
      </>
    ),
    plates: [
      { at: [27, 37], node: <circle cx="27" cy="37" r="7" fill={OTTER.c2} /> },
      { at: [37, 37], node: <circle cx="37" cy="37" r="7" fill={OTTER.c2} /> },
    ],
    front: [
      { at: [32, 33], node: <ellipse cx="32" cy="32.8" rx="3.6" ry="2.6" fill={OTTER.ink} /> },
      {
        at: [32, 39],
        node: (
          <path
            d="M28.6 38.2 Q30.3 40 32 38.4 Q33.7 40 35.4 38.2"
            fill="none"
            stroke={OTTER.ink}
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        ),
      },
    ],
    eyes: { l: [24, 27], r: [40, 27], rx: 2.8, ry: 3.4, fill: OTTER.ink },
  },
  beaver: {
    name: "Worker",
    role: "Worker · 海狸，埋头干活，一根一根搭起来",
    bg: "#8FAE8B",
    head: { cx: 32, cy: 30, r: 19 },
    back: (
      <>
        <circle cx="16" cy="17" r="5" fill={BEAVER.c1} />
        <circle cx="48" cy="17" r="5" fill={BEAVER.c1} />
      </>
    ),
    body: (
      <>
        <ellipse cx="32" cy="59" rx="18" ry="14" fill={BEAVER.c1} />
        <ellipse cx="32" cy="61" rx="10" ry="9" fill={BEAVER.c2} />
        <circle cx="32" cy="30" r="19" fill={BEAVER.c1} />
      </>
    ),
    plates: [
      { at: [32, 37], node: <ellipse cx="32" cy="37" rx="10.5" ry="7.5" fill={BEAVER.c2} /> },
    ],
    front: [
      { at: [32, 34], node: <ellipse cx="32" cy="33.5" rx="2.9" ry="2.1" fill={BEAVER.ink} /> },
      {
        at: [32, 43],
        node: (
          <>
            <rect
              x="28.4"
              y="40.5"
              width="3.4"
              height="5.4"
              rx="1.3"
              fill={BEAVER.c2}
              stroke={BEAVER.c1}
              strokeWidth="0.9"
            />
            <rect
              x="32.2"
              y="40.5"
              width="3.4"
              height="5.4"
              rx="1.3"
              fill={BEAVER.c2}
              stroke={BEAVER.c1}
              strokeWidth="0.9"
            />
          </>
        ),
      },
    ],
    eyes: { l: [24, 26], r: [40, 26], rx: 2.8, ry: 3.4, fill: BEAVER.ink },
  },
  puffin: {
    name: "Lighthouse 路由",
    role: "路由 · 海鹦，叼着消息送到对的人手里",
    bg: "#74A3BF",
    head: { cx: 32, cy: 33, r: 22 },
    back: (
      <>
        <ellipse cx="25" cy="61" rx="5" ry="2.6" fill={PUFFIN.c2} />
        <ellipse cx="39" cy="61" rx="5" ry="2.6" fill={PUFFIN.c2} />
      </>
    ),
    body: <ellipse cx="32" cy="36" rx="22" ry="24" fill={PUFFIN.c1} />,
    plates: [],
    front: [
      {
        at: [32, 41],
        node: (
          <path
            d="M24.5 37 Q32 31.5 39.5 37 Q39.5 46.5 32 48.5 Q24.5 46.5 24.5 37 Z"
            fill={PUFFIN.c2}
          />
        ),
      },
    ],
    eyes: { l: [23, 27], r: [41, 27], rx: 2.4, ry: 2.8, fill: PUFFIN.c1, ring: PUFFIN.c2 },
  },
  seal: {
    name: "总台",
    role: "总台 · 海豹，坐在门口，谁来都打招呼",
    bg: "#A391C2",
    head: { cx: 32, cy: 32, r: 20 },
    back: (
      <>
        <ellipse cx="13" cy="52" rx="7" ry="4" fill={SEAL.shade} transform="rotate(-30 13 52)" />
        <ellipse cx="51" cy="52" rx="7" ry="4" fill={SEAL.shade} transform="rotate(30 51 52)" />
      </>
    ),
    body: (
      <>
        <ellipse cx="32" cy="52" rx="19" ry="14" fill={SEAL.c1} />
        <circle cx="32" cy="32" r="20" fill={SEAL.c1} />
      </>
    ),
    plates: [],
    front: [
      { at: [32, 36], node: <ellipse cx="32" cy="36" rx="2.6" ry="1.9" fill={SEAL.c2} /> },
      {
        at: [32, 40],
        node: (
          <path
            d="M28.8 39.4 Q30.4 41 32 39.6 Q33.6 41 35.2 39.4"
            fill="none"
            stroke={SEAL.c2}
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        ),
      },
    ],
    eyes: { l: [24, 30], r: [40, 30], rx: 3.3, ry: 4, fill: SEAL.c2 },
  },
};

/** Numeric pose; every field eases with the same exponential curve. */
interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
  /** eye height multiplier: 1 open, below 1 squinting */
  open: number;
  /** eye size multiplier */
  size: number;
  /** mirrored eye tilt in degrees, positive raises the inner ends */
  tilt: number;
  /** ears droop, in viewBox units */
  droop: number;
  dots: number;
  ring: number;
  notif: number;
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const smooth = (t: number) => t * t * (3 - 2 * t);

const REST: Pose = {
  yaw: 7,
  pitch: 5,
  roll: 0,
  open: 1,
  size: 1,
  tilt: 0,
  droop: 0,
  dots: 0,
  ring: 0,
  notif: 0,
};
const KEYS = Object.keys(REST) as Array<keyof Pose>;

const FACE: Record<MascotState, Face> = {
  idle: "open",
  thinking: "open",
  working: "open",
  waiting: "open",
  done: "happy",
  blocked: "sad",
  sleeping: "closed",
};

/** Morph duration and whether the change hides behind a blink, as bloub does. */
const ENTRY: Record<MascotState, { morph: number; blinkIn: boolean }> = {
  idle: { morph: 0.45, blinkIn: false },
  thinking: { morph: 0.4, blinkIn: true },
  working: { morph: 0.5, blinkIn: true },
  waiting: { morph: 0.4, blinkIn: false },
  done: { morph: 0.45, blinkIn: true },
  blocked: { morph: 0.6, blinkIn: true },
  sleeping: { morph: 0.8, blinkIn: false },
};

function statePose(state: MascotState, t: number): Pose {
  switch (state) {
    case "thinking":
      return { ...REST, yaw: -17, pitch: 19, roll: 4, open: 0.92, dots: 1 };
    case "working": {
      // Head down on the work, with a short look up every few seconds.
      const phase = t % 4.6;
      const up =
        phase < 3.2
          ? 0
          : phase < 3.6
            ? smooth((phase - 3.2) / 0.4)
            : phase < 4.2
              ? 1
              : 1 - smooth((phase - 4.2) / 0.4);
      return {
        ...REST,
        yaw: lerp(11, 3, up),
        pitch: lerp(-17, 6, up),
        open: lerp(0.84, 1, up),
        ring: 1,
      };
    }
    case "waiting":
      return { ...REST, yaw: 0, pitch: 7, size: 1.08, notif: 1 };
    case "done": {
      const nod = t < 0.7 ? Math.sin((t / 0.7) * Math.PI) : 0;
      return { ...REST, yaw: 2, pitch: 9 - 12 * nod };
    }
    case "blocked":
      return { ...REST, yaw: -5, pitch: -13, roll: -5, open: 0.8, tilt: 16, droop: 2 };
    case "sleeping":
      return { ...REST, yaw: 3, pitch: -9, roll: 7, droop: 2.5 };
    default:
      return REST;
  }
}

const busyState = (s: MascotState) => s === "thinking" || s === "working";

/** Bloub's thinking pulse: a wave crossing the three dots left to right. */
function dotPulse(t: number, i: number) {
  const p = ((((t - i * 0.5) / 1.5) % 1) + 1) % 1;
  return clamp((p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0) * 2);
}

/** Bloub's blink: quick close, slower reopen, 0.18 s. */
function lid(t: number) {
  const k = t / 0.18;
  if (k < 0 || k > 1) return 1;
  return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55;
}

function project(head: Rig["head"], [x, y]: Point, yaw: number, pitch: number) {
  const ax = Math.asin(clamp((x - head.cx) / head.r, -0.95, 0.95));
  const ay = Math.asin(clamp((y - head.cy) / head.r, -0.95, 0.95));
  return {
    px: head.cx + head.r * Math.sin(ax + yaw * DEG),
    py: head.cy + head.r * Math.sin(ay - pitch * DEG),
    sx: Math.max(0.3, Math.cos(ax + yaw * DEG) / Math.cos(ax)),
    sy: Math.max(0.3, Math.cos(ay - pitch * DEG) / Math.cos(ay)),
  };
}

function partTransform(
  head: Rig["head"],
  p: Point,
  yaw: number,
  pitch: number,
  extra: { rotate?: number; sx?: number; sy?: number } = {},
) {
  const q = project(head, p, yaw, pitch);
  const sx = q.sx * (extra.sx ?? 1);
  const sy = q.sy * (extra.sy ?? 1);
  return `translate(${q.px.toFixed(2)} ${q.py.toFixed(2)}) rotate(${(extra.rotate ?? 0).toFixed(1)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-p[0]} ${-p[1]})`;
}

interface Nodes {
  back: SVGGElement;
  face: SVGGElement;
  parts: SVGGElement[];
  eyes: SVGGElement[];
  dots: SVGGElement;
  ringBack: SVGGElement;
  ringFront: SVGGElement;
  notif: SVGGElement;
}

type Turn = { yaw: number; pitch: number; roll: number };

class MascotEngine {
  state: MascotState = "idle";
  enteredAt = 0;
  from: Pose = { ...REST };
  shown: Pose = { ...REST };
  blinkAt = -10;
  glance: { from: Turn; to: Turn; at: number } = {
    from: { yaw: 0, pitch: 0, roll: 0 },
    to: { yaw: 0, pitch: 0, roll: 0 },
    at: -10,
  };
  look = { yaw: 0, pitch: 0, mix: 0 };
  lookTarget: { yaw: number; pitch: number } | null = null;
  visible = true;
  timer: ReturnType<typeof setTimeout> | null = null;
  last = 0;
  pendingFace: Face | null = null;

  constructor(
    readonly rig: Rig,
    readonly nodes: Nodes,
    readonly glances: boolean,
    readonly onFace: (face: Face) => void,
  ) {}

  setState(state: MascotState, now: number, first: boolean) {
    const previous = this.state;
    this.from = first ? statePose(state, 0) : { ...this.shown };
    this.shown = { ...this.from };
    this.state = state;
    this.enteredAt = now;
    if (first) return;
    if (ENTRY[state].blinkIn || FACE[state] !== FACE[previous]) {
      this.blinkAt = now;
      this.pendingFace = FACE[state];
    }
  }

  private glanceOffset(now: number): Turn {
    const k = easeOutCubic(clamp((now - this.glance.at) / 0.6));
    const { from, to } = this.glance;
    return {
      yaw: lerp(from.yaw, to.yaw, k),
      pitch: lerp(from.pitch, to.pitch, k),
      roll: lerp(from.roll, to.roll, k),
    };
  }

  /** Life at rest, as timed events: a blink, or a small head turn that then holds. */
  private scheduleLife() {
    if (this.timer || !this.visible || this.state === "sleeping") return;
    const wait = this.glances ? 2.2 + Math.random() * 3.4 : 8 + Math.random() * 8;
    this.timer = setTimeout(() => {
      this.timer = null;
      const at = performance.now() / 1000;
      if (this.glances && Math.random() < 0.55) {
        this.glance = {
          from: this.glanceOffset(at),
          to: {
            yaw: (Math.random() * 2 - 1) * 7,
            pitch: (Math.random() * 2 - 1) * 5,
            roll: (Math.random() * 2 - 1) * 2.5,
          },
          at,
        };
        if (Math.random() < 0.4) this.blinkAt = at + 0.05;
      } else {
        this.blinkAt = at;
      }
      wake(this);
    }, wait * 1000);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Renders one frame; returns whether more frames are needed right now. */
  frame(now: number): boolean {
    const t = now - this.enteredAt;
    const { morph } = ENTRY[this.state];
    const k = easeOutQuint(clamp(t / morph));
    const target = statePose(this.state, t);
    const pose = { ...REST };
    for (const key of KEYS) pose[key] = lerp(this.from[key], target[key], k);
    this.shown = pose;

    // Pointer look replaces the pose's direction as `mix` rises; drift dies while it does.
    const dt = this.last === 0 ? 1 / 60 : Math.min(0.1, now - this.last);
    this.last = now;
    const follow = 1 - Math.exp(-dt * 9);
    const want = this.lookTarget ?? { yaw: this.look.yaw, pitch: this.look.pitch };
    this.look.yaw = lerp(this.look.yaw, want.yaw, follow);
    this.look.pitch = lerp(this.look.pitch, want.pitch, follow);
    this.look.mix = lerp(this.look.mix, this.lookTarget ? 1 : 0, follow);
    const g = this.glanceOffset(now);
    const drift = 1 - this.look.mix;
    const yaw = lerp(pose.yaw, this.look.yaw, this.look.mix) + g.yaw * drift;
    const pitch = lerp(pose.pitch, this.look.pitch, this.look.mix) + g.pitch * drift;
    const roll = pose.roll + g.roll * drift;

    const blinkT = now - this.blinkAt;
    if (this.pendingFace && blinkT >= 0.08) {
      this.onFace(this.pendingFace);
      this.pendingFace = null;
    }
    this.write(yaw, pitch, roll, pose, lid(blinkT), t);

    const lookSettled =
      Math.abs(this.look.mix - (this.lookTarget ? 1 : 0)) < 0.002 &&
      Math.abs(this.look.yaw - want.yaw) < 0.05 &&
      Math.abs(this.look.pitch - want.pitch) < 0.05;
    const busy =
      busyState(this.state) ||
      t < morph + 0.05 ||
      (this.state === "done" && t < 0.8) ||
      (this.state === "waiting" && t < 0.4) ||
      blinkT < 0.2 ||
      now - this.glance.at < 0.65 ||
      !lookSettled;
    if (!busy) {
      this.last = 0;
      this.scheduleLife();
    }
    return this.visible && busy;
  }

  private write(yaw: number, pitch: number, roll: number, pose: Pose, lidK: number, t: number) {
    const { head, eyes, plates, front } = this.rig;
    const n = this.nodes;
    const shiftX = head.r * Math.sin(yaw * DEG);
    const shiftY = -head.r * Math.sin(pitch * DEG);
    put(
      n.back,
      "transform",
      `translate(${(-shiftX * 0.25).toFixed(2)} ${(-shiftY * 0.25 + pose.droop).toFixed(2)})`,
    );
    put(n.face, "transform", `rotate(${roll.toFixed(2)} ${head.cx} ${head.cy})`);
    [...plates, ...front].forEach((part, i) => {
      put(n.parts[i], "transform", partTransform(head, part.at, yaw, pitch));
    });
    const open = pose.open * (0.06 + 0.94 * lidK);
    [eyes.l, eyes.r].forEach((p, i) => {
      put(
        n.eyes[i],
        "transform",
        partTransform(head, p, yaw, pitch, {
          rotate: (i === 0 ? 1 : -1) * pose.tilt,
          sx: pose.size,
          sy: pose.size * open,
        }),
      );
    });
    put(n.dots, "opacity", pose.dots.toFixed(3));
    Array.from(n.dots.children).forEach((dot, i) => {
      const k = dotPulse(t, i);
      put(dot, "transform", `scale(${(1 + 0.35 * k).toFixed(3)})`);
      put(dot, "opacity", (0.55 + 0.45 * k).toFixed(3));
    });
    // A flat orbit seen from slightly above: the dot passes behind the body on the far half.
    const phi = t * (TAU / 1.8);
    const ox = (head.r + 8) * Math.cos(phi);
    const oy = 5 * Math.sin(phi);
    const behind = Math.sin(phi) < 0;
    put(n.ringBack, "opacity", pose.ring.toFixed(3));
    put(n.ringFront, "opacity", pose.ring.toFixed(3));
    for (const [group, show] of [
      [n.ringBack, behind],
      [n.ringFront, !behind],
    ] as const) {
      const dot = group.lastElementChild;
      put(dot, "cx", (head.cx + ox).toFixed(2));
      put(dot, "cy", (head.cy + oy).toFixed(2));
      put(dot, "opacity", show ? "1" : "0");
    }
    // Bloub's notification pastille: the one local spring, a 14% pop on arrival.
    const pt = clamp(t / 0.35);
    const pop =
      pt < 0.57 ? 1.14 * easeOutCubic(pt / 0.57) : 1.14 - 0.14 * easeOutCubic((pt - 0.57) / 0.43);
    const scale = this.state === "waiting" ? pop : pose.notif;
    put(n.notif, "opacity", scale > 0.01 ? "1" : "0");
    put(
      n.notif,
      "transform",
      `translate(${head.cx + head.r * 0.72} ${head.cy - head.r * 0.74}) scale(${scale.toFixed(3)})`,
    );
  }
}

const engines = new Set<MascotEngine>();

// A blink moves only the eyes; skipping unchanged attributes keeps a frame to that.
function put(el: Element | null | undefined, name: string, value: string) {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}
let raf = 0;

function tick(ms: number) {
  raf = 0;
  const now = ms / 1000;
  for (const e of engines) if (!e.frame(now)) engines.delete(e);
  if (engines.size > 0) raf = requestAnimationFrame(tick);
}

function wake(e: MascotEngine) {
  if (!e.visible) return;
  engines.add(e);
  if (raf === 0) raf = requestAnimationFrame(tick);
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Eye({
  cx,
  cy,
  rx,
  ry,
  fill,
  face,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
  face: Face;
}) {
  if (face === "happy") {
    return (
      <path
        d={`M${cx - rx - 0.6} ${cy + 1} Q${cx} ${cy - ry * 1.6} ${cx + rx + 0.6} ${cy + 1}`}
        fill="none"
        stroke={fill}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    );
  }
  if (face === "closed") {
    return (
      <path
        d={`M${cx - rx - 0.4} ${cy} Q${cx} ${cy + ry * 0.9} ${cx + rx + 0.4} ${cy}`}
        fill="none"
        stroke={fill}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    );
  }
  return <ellipse cx={cx} cy={cy} rx={rx} ry={face === "sad" ? ry * 0.85 : ry} fill={fill} />;
}

export function Mascot({
  kind,
  state = "idle",
  className,
  framed,
  followPointer,
  lively,
}: {
  kind: MascotKind;
  state?: MascotState;
  className?: string;
  /** Draws the IP's own muted background, as in the ip-as-logo art. */
  framed?: boolean;
  /** Tracks the pointer anywhere on the page instead of only while hovered. */
  followPointer?: boolean;
  /** Adds small head turns between blinks; for large showcase mascots. */
  lively?: boolean;
}) {
  const rig = MASCOTS[kind];
  const host = useRef<HTMLSpanElement>(null);
  const back = useRef<SVGGElement>(null);
  const face = useRef<SVGGElement>(null);
  const parts = useRef<SVGGElement[]>([]);
  const eyes = useRef<SVGGElement[]>([]);
  const dots = useRef<SVGGElement>(null);
  const ringBack = useRef<SVGGElement>(null);
  const ringFront = useRef<SVGGElement>(null);
  const notif = useRef<SVGGElement>(null);
  const engineRef = useRef<MascotEngine | null>(null);
  const firstState = useRef(true);
  const [ready, setReady] = useState(false);
  const [shownFace, setShownFace] = useState<Face>(FACE[state]);
  const drawnFace = ready ? shownFace : FACE[state];

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the imperative rig and the viewport observer to the mounted SVG
  useEffect(() => {
    if (reducedMotion() || !host.current || !back.current || !face.current) return;
    if (!dots.current || !ringBack.current || !ringFront.current || !notif.current) return;
    const engine = new MascotEngine(
      rig,
      {
        back: back.current,
        face: face.current,
        parts: parts.current,
        eyes: eyes.current,
        dots: dots.current,
        ringBack: ringBack.current,
        ringFront: ringFront.current,
        notif: notif.current,
      },
      lively === true,
      setShownFace,
    );
    const observer = new IntersectionObserver(([entry]) => {
      engine.visible = entry?.isIntersecting ?? true;
      if (engine.visible) wake(engine);
      else engine.stop();
    });
    observer.observe(host.current);
    engineRef.current = engine;
    firstState.current = true;
    setReady(true);
    return () => {
      observer.disconnect();
      engine.visible = false;
      engine.stop();
      engines.delete(engine);
      engineRef.current = null;
      setReady(false);
    };
  }, [rig, lively]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the state prop into the imperative rig, which owns timing
  useEffect(() => {
    const engine = engineRef.current;
    if (!ready || !engine) return;
    engine.stop();
    engine.setState(state, performance.now() / 1000, firstState.current);
    if (firstState.current) setShownFace(FACE[state]);
    firstState.current = false;
    wake(engine);
  }, [ready, state]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- page-wide pointer tracking for showcase mascots
  useEffect(() => {
    const engine = engineRef.current;
    const el = host.current;
    if (!ready || !engine || !followPointer || !el) return;
    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const dx = (event.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2);
      const dy = (event.clientY - (box.top + box.height / 2)) / (window.innerHeight / 2);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      engine.lookTarget = {
        yaw: clamp(dx * 1.4, -1, 1) * 16,
        pitch: 8 - clamp(dy * 1.4, -1, 1) * 13,
      };
      wake(engine);
    };
    const onLeave = () => {
      engine.lookTarget = null;
      wake(engine);
    };
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      engine.lookTarget = null;
    };
  }, [ready, followPointer]);

  const hover = followPointer
    ? {}
    : {
        onPointerMove: (event: ReactPointerEvent<HTMLSpanElement>) => {
          const engine = engineRef.current;
          if (!engine) return;
          const box = event.currentTarget.getBoundingClientRect();
          const dx = ((event.clientX - box.left) / box.width) * 2 - 1;
          const dy = ((event.clientY - box.top) / box.height) * 2 - 1;
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
          engine.lookTarget = { yaw: dx * 16, pitch: 6 - dy * 12 };
          wake(engine);
        },
        onPointerLeave: () => {
          const engine = engineRef.current;
          if (!engine) return;
          engine.lookTarget = null;
          wake(engine);
        },
      };

  const { head } = rig;
  const still = ready ? null : statePose(state, 10);
  const stillTransform = (p: Point, isEye: number | null) =>
    still
      ? partTransform(
          head,
          p,
          still.yaw,
          still.pitch,
          isEye === null
            ? {}
            : {
                rotate: (isEye === 0 ? 1 : -1) * still.tilt,
                sx: still.size,
                sy: still.size * still.open,
              },
        )
      : undefined;
  const rx = head.r + 8;
  const parts_ = [...rig.plates, ...rig.front];

  return (
    <span
      ref={host}
      className={cn("relative inline-flex shrink-0 overflow-hidden", className)}
      style={framed ? { backgroundColor: rig.bg } : undefined}
      role="img"
      aria-label={rig.name}
      {...hover}
    >
      <svg viewBox="0 0 64 64" className="size-full" aria-hidden="true">
        <g ref={ringBack} opacity={0}>
          <path
            d={`M${head.cx - rx} ${head.cy} A${rx} 5 0 0 1 ${head.cx + rx} ${head.cy}`}
            fill="none"
            stroke="var(--color-zinc-25)"
            strokeOpacity="0.35"
            strokeWidth="1.4"
          />
          <circle r="1.9" fill="var(--color-zinc-25)" opacity="0" />
        </g>
        <g ref={back} transform={still ? `translate(0 ${still.droop})` : undefined}>
          {rig.back}
        </g>
        {rig.body}
        <g ref={face} transform={still ? `rotate(${still.roll} ${head.cx} ${head.cy})` : undefined}>
          {parts_.map((part, i) => (
            <g
              key={`${part.at[0]}-${part.at[1]}`}
              ref={(el) => {
                if (el) parts.current[i] = el;
              }}
              transform={stillTransform(part.at, null)}
            >
              {part.node}
            </g>
          ))}
          {[rig.eyes.l, rig.eyes.r].map((p, i) => (
            <g
              key={i === 0 ? "left" : "right"}
              ref={(el) => {
                if (el) eyes.current[i] = el;
              }}
              transform={stillTransform(p, i)}
            >
              {rig.eyes.ring ? <circle cx={p[0]} cy={p[1]} r={5.4} fill={rig.eyes.ring} /> : null}
              <Eye
                cx={p[0]}
                cy={p[1]}
                rx={rig.eyes.rx}
                ry={rig.eyes.ry}
                fill={rig.eyes.fill}
                face={drawnFace}
              />
            </g>
          ))}
        </g>
        <g ref={ringFront} opacity={0}>
          <path
            d={`M${head.cx - rx} ${head.cy} A${rx} 5 0 0 0 ${head.cx + rx} ${head.cy}`}
            fill="none"
            stroke="var(--color-zinc-25)"
            strokeOpacity="0.6"
            strokeWidth="1.4"
          />
          <circle r="1.9" fill="var(--color-zinc-25)" opacity="0" />
        </g>
        <g ref={dots} opacity={still?.dots ?? 0}>
          {[47, 53, 59].map((x) => (
            <g key={x} style={{ transformOrigin: `${x}px 9px` }}>
              <circle cx={x} cy="9" r="2.3" fill="var(--color-zinc-25)" />
            </g>
          ))}
        </g>
        <g
          ref={notif}
          opacity={still?.notif ?? 0}
          transform={`translate(${head.cx + head.r * 0.72} ${head.cy - head.r * 0.74})`}
        >
          <circle r="5.2" fill={framed ? rig.bg : "var(--color-zinc-25)"} />
          <circle r="3.8" fill="var(--color-info)" />
        </g>
      </svg>
    </span>
  );
}
