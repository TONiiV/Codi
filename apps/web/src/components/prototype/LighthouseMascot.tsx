// PROTOTYPE, wipe me. Agent IP mascots drawn as vector rigs from the ip-as-logo art in
// apps/lighthouse/prototype/ip, animated the Grok Bot way: damped springs chase per-state
// pose targets. Mascots stand still at rest and only move while working or thinking, on a
// state change, or under the pointer. One shared frame loop stops when every rig settles.
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

interface Rig {
  name: string;
  role: string;
  bg: string;
  eyes: { l: [number, number]; r: [number, number]; rx: number; ry: number; fill: string };
  body: ReactNode;
  front?: ReactNode;
  eyeRing?: { r: number; fill: string };
}

const OWL = { c1: "#C98A4B", c2: "#F6E7CC", ink: "#7A4E25" };
const OTTER = { c1: "#7A5544", c2: "#F3E2C7", ink: "#3B2A22" };
const BEAVER = { c1: "#D9772E", c2: "#FBF1DC", ink: "#2E2219" };
const PUFFIN = { c1: "#2B2B2E", c2: "#E8893A" };
const SEAL = { c1: "#D9DEE3", c2: "#2F3338", shade: "#BEC6CE" };

export const MASCOTS: Record<MascotKind, Rig> = {
  owl: {
    name: "砚书",
    role: "私人幕僚长 · 猫头鹰，守夜，什么都看得见",
    bg: "#3F4A63",
    eyes: { l: [24, 31], r: [40, 31], rx: 3.3, ry: 4, fill: OWL.ink },
    body: (
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
        <ellipse cx="32" cy="38" rx="23" ry="25" fill={OWL.c1} />
        <ellipse cx="32" cy="56" rx="13" ry="10" fill={OWL.c2} />
        <circle cx="24" cy="31" r="9.5" fill={OWL.c2} />
        <circle cx="40" cy="31" r="9.5" fill={OWL.c2} />
      </>
    ),
    front: (
      <path
        d="M29.5 37.5 Q32 36 34.5 37.5 L32 41.5 Z"
        fill={OWL.c1}
        stroke={OWL.c1}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    ),
  },
  otter: {
    name: "项目幕僚长",
    role: "项目幕僚长 · 海獭，手牵手不让项目漂走",
    bg: "#5F9E99",
    eyes: { l: [24, 27], r: [40, 27], rx: 2.8, ry: 3.4, fill: OTTER.ink },
    body: (
      <>
        <circle cx="17" cy="18" r="5" fill={OTTER.c1} />
        <circle cx="47" cy="18" r="5" fill={OTTER.c1} />
        <ellipse cx="32" cy="58" rx="18" ry="15" fill={OTTER.c1} />
        <ellipse cx="32" cy="60" rx="10" ry="9" fill={OTTER.c2} />
        <ellipse cx="32" cy="30" rx="19.5" ry="17.5" fill={OTTER.c1} />
        <circle cx="27" cy="37" r="7" fill={OTTER.c2} />
        <circle cx="37" cy="37" r="7" fill={OTTER.c2} />
      </>
    ),
    front: (
      <>
        <ellipse cx="32" cy="32.8" rx="3.6" ry="2.6" fill={OTTER.ink} />
        <path
          d="M28.6 38.2 Q30.3 40 32 38.4 Q33.7 40 35.4 38.2"
          fill="none"
          stroke={OTTER.ink}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </>
    ),
  },
  beaver: {
    name: "Worker",
    role: "Worker · 海狸，埋头干活，一根一根搭起来",
    bg: "#8FAE8B",
    eyes: { l: [24, 26], r: [40, 26], rx: 2.8, ry: 3.4, fill: BEAVER.ink },
    body: (
      <>
        <circle cx="16" cy="17" r="5" fill={BEAVER.c1} />
        <circle cx="48" cy="17" r="5" fill={BEAVER.c1} />
        <ellipse cx="32" cy="59" rx="18" ry="14" fill={BEAVER.c1} />
        <ellipse cx="32" cy="61" rx="10" ry="9" fill={BEAVER.c2} />
        <circle cx="32" cy="30" r="19" fill={BEAVER.c1} />
        <ellipse cx="32" cy="37" rx="10.5" ry="7.5" fill={BEAVER.c2} />
      </>
    ),
    front: (
      <>
        <ellipse cx="32" cy="33.5" rx="2.9" ry="2.1" fill={BEAVER.ink} />
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
  puffin: {
    name: "Lighthouse 路由",
    role: "路由 · 海鹦，叼着消息送到对的人手里",
    bg: "#74A3BF",
    eyes: { l: [23, 27], r: [41, 27], rx: 2.4, ry: 2.8, fill: PUFFIN.c1 },
    eyeRing: { r: 5.4, fill: PUFFIN.c2 },
    body: (
      <>
        <ellipse cx="25" cy="61" rx="5" ry="2.6" fill={PUFFIN.c2} />
        <ellipse cx="39" cy="61" rx="5" ry="2.6" fill={PUFFIN.c2} />
        <ellipse cx="32" cy="36" rx="22" ry="24" fill={PUFFIN.c1} />
      </>
    ),
    front: (
      <path
        d="M24.5 37 Q32 31.5 39.5 37 Q39.5 46.5 32 48.5 Q24.5 46.5 24.5 37 Z"
        fill={PUFFIN.c2}
      />
    ),
  },
  seal: {
    name: "总台",
    role: "总台 · 海豹，坐在门口，谁来都打招呼",
    bg: "#A391C2",
    eyes: { l: [24, 30], r: [40, 30], rx: 3.3, ry: 4, fill: SEAL.c2 },
    body: (
      <>
        <ellipse cx="13" cy="52" rx="7" ry="4" fill={SEAL.shade} transform="rotate(-30 13 52)" />
        <ellipse cx="51" cy="52" rx="7" ry="4" fill={SEAL.shade} transform="rotate(30 51 52)" />
        <ellipse cx="32" cy="52" rx="19" ry="14" fill={SEAL.c1} />
        <circle cx="32" cy="32" r="20" fill={SEAL.c1} />
      </>
    ),
    front: (
      <>
        <ellipse cx="32" cy="36" rx="2.6" ry="1.9" fill={SEAL.c2} />
        <path
          d="M28.8 39.4 Q30.4 41 32 39.6 Q33.6 41 35.2 39.4"
          fill="none"
          stroke={SEAL.c2}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </>
    ),
  },
};

type Channel = "x" | "y" | "rot" | "sx" | "sy" | "eye" | "gx" | "gy" | "dots";
type Pose = Partial<Record<Channel, number>>;

const REST: Record<Channel, number> = {
  x: 0,
  y: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  eye: 1,
  gx: 0,
  gy: 0,
  dots: 0,
};
const CHANNELS = Object.keys(REST) as Channel[];
const SPRING: Record<Channel, [stiffness: number, damping: number]> = {
  x: [180, 15],
  y: [220, 15],
  rot: [160, 12],
  sx: [260, 16],
  sy: [260, 16],
  eye: [900, 50],
  gx: [120, 16],
  gy: [120, 16],
  dots: [120, 18],
};

interface Clip {
  duration: number;
  pose: (t: number) => Pose;
}

const hop = (height: number): Clip => ({
  duration: 1.05,
  pose: (t) =>
    t < 0.16
      ? { sy: 0.86, sx: 1.1 }
      : t < 0.48
        ? { y: -height, sy: 1.08, sx: 0.94 }
        : t < 0.66
          ? { sy: 0.9, sx: 1.08 }
          : {},
});

const WORK_CLIPS: ReadonlyArray<Clip> = [
  hop(7),
  {
    duration: 1.5,
    pose: (t) => (t < 1.15 ? { rot: 9 * Math.sin(t * Math.PI * 4.4) } : {}),
  },
  {
    duration: 1.4,
    pose: (t) => (t < 1.15 ? (Math.floor(t * 4) % 2 ? { y: 1.8, rot: 2 } : { y: -0.6 }) : {}),
  },
  {
    duration: 1.4,
    pose: (t) => {
      if (t >= 1) return {};
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      return { sx: Math.cos(e * Math.PI * 2), y: -2 };
    },
  },
  {
    duration: 2.1,
    pose: (t) =>
      t < 0.7 ? { gx: -1, gy: -0.2 } : t < 1.4 ? { gx: 1, gy: -0.2 } : { gx: 0, gy: 0 },
  },
];

function stateFace(state: MascotState): Face {
  if (state === "done") return "happy";
  if (state === "blocked") return "sad";
  if (state === "sleeping") return "closed";
  return "open";
}

/** One-shot clip played when a state is entered; the loop may stop once it ends. */
function enterClip(state: MascotState): Clip | null {
  if (state === "waiting") return hop(4);
  if (state === "done") {
    const one = hop(8);
    return { duration: 2, pose: (t) => (t < 1 ? one.pose(t) : one.pose(t - 1)) };
  }
  return null;
}

function holdPose(state: MascotState): Pose {
  if (state === "waiting") return { gy: -0.45 };
  if (state === "blocked") return { y: 2.5, rot: -7, sy: 0.95, sx: 1.03 };
  if (state === "sleeping") return { y: 1.5, sy: 0.97, sx: 1.02 };
  return {};
}

const continuous = (state: MascotState) => state === "working" || state === "thinking";

class MascotRig {
  value = { ...REST };
  velocity: Record<Channel, number> = {
    x: 0,
    y: 0,
    rot: 0,
    sx: 0,
    sy: 0,
    eye: 0,
    gx: 0,
    gy: 0,
    dots: 0,
  };
  state: MascotState = "idle";
  enteredAt = 0;
  bag: Clip[] = [];
  clip: Clip | null = null;
  clipAt = 0;
  nextBlink = 0;
  blinkUntil = 0;
  pointer: { x: number; y: number } | null = null;
  visible = true;
  last = 0;

  constructor(
    readonly root: SVGGElement,
    readonly eyes: SVGGElement,
    readonly dots: SVGGElement | null,
    readonly eyeY: number,
  ) {}

  setState(state: MascotState, now: number) {
    this.state = state;
    this.enteredAt = now;
    this.clip = enterClip(state);
    this.clipAt = now;
    this.bag = [];
    this.blink(now);
  }

  blink(now: number) {
    if (this.state === "sleeping") return;
    this.blinkUntil = now + 0.13;
    this.nextBlink = now + 2.4 + Math.random() * 3;
  }

  private nextWorkClip(now: number) {
    if (this.bag.length === 0) {
      this.bag = [...WORK_CLIPS].sort(() => Math.random() - 0.5);
    }
    this.clip = this.bag.pop() ?? null;
    this.clipAt = now + 0.45;
  }

  private target(now: number): Record<Channel, number> {
    const t = now - this.enteredAt;
    const pose: Pose = { ...holdPose(this.state) };
    if (this.state === "thinking") {
      Object.assign(pose, { rot: Math.sin(t * 1.6) > 0 ? 6 : -6, gx: -0.5, gy: -0.75, dots: 1 });
    }
    if (this.state === "working" && (!this.clip || now - this.clipAt > this.clip.duration)) {
      this.nextWorkClip(now);
    }
    if (this.clip && now >= this.clipAt && now - this.clipAt <= this.clip.duration) {
      Object.assign(pose, this.clip.pose(now - this.clipAt));
    }
    if (continuous(this.state) && now > this.nextBlink) this.blink(now);
    if (this.pointer && this.state !== "sleeping") {
      pose.gx = this.pointer.x;
      pose.gy = this.pointer.y;
    }
    const eyeBase = this.state === "blocked" ? 0.55 : 1;
    pose.eye = now < this.blinkUntil ? 0.06 : eyeBase;
    return { ...REST, ...pose };
  }

  /** Advances the springs; returns whether this rig still needs frames. */
  step(now: number): boolean {
    const target = this.target(now);
    let dt = Math.min(0.05, this.last === 0 ? 1 / 60 : now - this.last);
    this.last = now;
    let moving = false;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 120);
      dt -= h;
      for (const c of CHANNELS) {
        const [k, d] = SPRING[c];
        const a = -k * (this.value[c] - target[c]) - d * this.velocity[c];
        this.velocity[c] += a * h;
        this.value[c] += this.velocity[c] * h;
      }
    }
    for (const c of CHANNELS) {
      if (Math.abs(this.value[c] - target[c]) > 0.002 || Math.abs(this.velocity[c]) > 0.01) {
        moving = true;
      }
    }
    this.write(now);
    const clipLive = this.clip !== null && now - this.clipAt <= this.clip.duration;
    const busy =
      continuous(this.state) || clipLive || now < this.blinkUntil + 0.2 || this.pointer !== null;
    if (!busy && !moving) this.last = 0;
    return this.visible && (busy || moving);
  }

  write(now: number) {
    const v = this.value;
    this.root.setAttribute(
      "transform",
      `translate(${v.x} ${v.y}) rotate(${v.rot} 32 60) translate(32 60) scale(${v.sx} ${v.sy}) translate(-32 -60)`,
    );
    this.eyes.setAttribute(
      "transform",
      `translate(${v.gx * 2.4} ${v.gy * 1.8}) translate(0 ${this.eyeY}) scale(1 ${Math.max(0.06, v.eye)}) translate(0 ${-this.eyeY})`,
    );
    if (this.dots) {
      this.dots.setAttribute("opacity", String(Math.max(0, Math.min(1, v.dots))));
      const t = now - this.enteredAt;
      Array.from(this.dots.children).forEach((dot, i) => {
        const s = 0.65 + 0.35 * Math.max(0, Math.sin(t * 5 - i * 0.9));
        dot.setAttribute("transform", `scale(${s})`);
      });
    }
  }
}

const rigs = new Set<MascotRig>();
let frame = 0;

function tick(ms: number) {
  frame = 0;
  const now = ms / 1000;
  for (const rig of rigs) {
    if (!rig.step(now)) rigs.delete(rig);
  }
  if (rigs.size > 0) frame = requestAnimationFrame(tick);
}

function wake(rig: MascotRig) {
  if (!rig.visible) return;
  rigs.add(rig);
  if (frame === 0) frame = requestAnimationFrame(tick);
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function staticTransform(state: MascotState) {
  const v = { ...REST, ...holdPose(state) };
  return `translate(${v.x} ${v.y}) rotate(${v.rot} 32 60) translate(32 60) scale(${v.sx} ${v.sy}) translate(-32 -60)`;
}

function Eyes({ rig, face }: { rig: Rig; face: Face }) {
  const { l, r, rx, ry, fill } = rig.eyes;
  return (
    <>
      {[l, r].map(([cx, cy]) =>
        face === "happy" ? (
          <path
            key={cx}
            d={`M${cx - rx - 0.6} ${cy + 1} Q${cx} ${cy - ry * 1.6} ${cx + rx + 0.6} ${cy + 1}`}
            fill="none"
            stroke={fill}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        ) : face === "closed" ? (
          <path
            key={cx}
            d={`M${cx - rx - 0.4} ${cy} Q${cx} ${cy + ry * 0.9} ${cx + rx + 0.4} ${cy}`}
            fill="none"
            stroke={fill}
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        ) : (
          <ellipse
            key={cx}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={face === "sad" ? ry * 0.8 : ry}
            fill={fill}
          />
        ),
      )}
    </>
  );
}

export function Mascot({
  kind,
  state = "idle",
  className,
  framed,
  followPointer,
}: {
  kind: MascotKind;
  state?: MascotState;
  className?: string;
  /** Draws the IP's own muted background square, as in the ip-as-logo art. */
  framed?: boolean;
  /** Tracks the pointer anywhere on the page instead of only while hovered. */
  followPointer?: boolean;
}) {
  const rig = MASCOTS[kind];
  const root = useRef<SVGGElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const dots = useRef<SVGGElement>(null);
  const host = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<MascotRig | null>(null);
  const [ready, setReady] = useState(false);
  const face = stateFace(state);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the imperative spring rig and the viewport observer to the mounted SVG
  useEffect(() => {
    if (!root.current || !eyes.current || !host.current || reducedMotion()) return;
    const instance = new MascotRig(root.current, eyes.current, dots.current, rig.eyes.l[1]);
    const observer = new IntersectionObserver(([entry]) => {
      instance.visible = entry?.isIntersecting ?? true;
      if (instance.visible) wake(instance);
    });
    observer.observe(host.current);
    engineRef.current = instance;
    setReady(true);
    return () => {
      observer.disconnect();
      instance.visible = false;
      rigs.delete(instance);
      engineRef.current = null;
      setReady(false);
    };
  }, [rig]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the state prop into the imperative rig, which owns timing
  useEffect(() => {
    const engine = engineRef.current;
    if (!ready || !engine) return;
    engine.setState(state, performance.now() / 1000);
    wake(engine);
  }, [ready, state]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- page-wide pointer tracking for large showcase mascots
  useEffect(() => {
    const engine = engineRef.current;
    if (!ready || !engine || !followPointer || !host.current) return;
    const el = host.current;
    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const dx = (event.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2);
      const dy = (event.clientY - (box.top + box.height / 2)) / (window.innerHeight / 2);
      engine.pointer = {
        x: Math.max(-1, Math.min(1, dx * 1.6)),
        y: Math.max(-1, Math.min(1, dy * 1.6)),
      };
      wake(engine);
    };
    const onLeave = () => {
      engine.pointer = null;
      wake(engine);
    };
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      engine.pointer = null;
    };
  }, [ready, followPointer]);

  const hover = followPointer
    ? {}
    : {
        onPointerEnter: () => {
          const engine = engineRef.current;
          if (!engine) return;
          engine.blink(performance.now() / 1000);
          wake(engine);
        },
        onPointerMove: (event: ReactPointerEvent<HTMLSpanElement>) => {
          const engine = engineRef.current;
          if (!engine) return;
          const box = event.currentTarget.getBoundingClientRect();
          engine.pointer = {
            x: ((event.clientX - box.left) / box.width) * 2 - 1,
            y: ((event.clientY - box.top) / box.height) * 2 - 1,
          };
          wake(engine);
        },
        onPointerLeave: () => {
          const engine = engineRef.current;
          if (!engine) return;
          engine.pointer = null;
          wake(engine);
        },
      };

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
        <g ref={root} transform={ready ? undefined : staticTransform(state)}>
          {rig.body}
          {rig.eyeRing
            ? [rig.eyes.l, rig.eyes.r].map(([cx, cy]) => (
                <circle key={cx} cx={cx} cy={cy} r={rig.eyeRing!.r} fill={rig.eyeRing!.fill} />
              ))
            : null}
          <g ref={eyes}>
            <Eyes rig={rig} face={face} />
          </g>
          {rig.front}
        </g>
        <g ref={dots} opacity={state === "thinking" && !ready ? 1 : 0}>
          <circle
            cx="47"
            cy="9"
            r="2.4"
            fill="currentColor"
            style={{ transformOrigin: "47px 9px" }}
          />
          <circle
            cx="53"
            cy="9"
            r="2.4"
            fill="currentColor"
            style={{ transformOrigin: "53px 9px" }}
          />
          <circle
            cx="59"
            cy="9"
            r="2.4"
            fill="currentColor"
            style={{ transformOrigin: "59px 9px" }}
          />
        </g>
      </svg>
    </span>
  );
}
