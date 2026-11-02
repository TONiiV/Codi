// PROTOTYPE, wipe me. Agent avatars drawn by bloub (github.com/jeremy-prt/bloub, MIT, see
// ./bloub/LICENSE). ./bloub is its engine copied as-is; this file only renders its frames,
// gives each agent a seeded shape and colour, and maps agent states onto bloub states.
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "../../lib/utils";
import { NOTIF_BLUE } from "./bloub/decor";
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from "./bloub/expressions";
import { liveliness } from "./bloub/face";
import { BotEngine, type BotFrame } from "./bloub/engine";
import { TURN, TURN_TIME, lookTarget } from "./bloub/gaze";
import { clamp, easings } from "./bloub/math";
import { DEMI_VIEWBOX, RAYON } from "./bloub/repere";
import { COLORS, SHAPES } from "./bloub/skins";
import { POSES, STATE_BY_ID, type StateId } from "./bloub/states";

export const AGENT_STATES = [
  { id: "idle", label: "待命", bloub: "idle" },
  { id: "thinking", label: "思考", bloub: "thinking" },
  { id: "working", label: "干活", bloub: "orbit" },
  { id: "waiting", label: "等你", bloub: "notify" },
  { id: "done", label: "完成", bloub: "wink" },
  { id: "blocked", label: "卡住", bloub: "alert" },
  { id: "sleeping", label: "离线", bloub: "idle" },
] as const satisfies ReadonlyArray<{ id: string; label: string; bloub: StateId }>;
export type AgentState = (typeof AGENT_STATES)[number]["id"];

// Bloub's own sleep shrinks to a dot that reads as empty at avatar size; sleepy eyes read.
const face = (state: AgentState) =>
  EXPRESSION_BY_ID.get(state === "sleeping" ? "somnolent" : DEFAULT_EXPRESSION) ?? null;

const BLOUB = Object.fromEntries(AGENT_STATES.map((s) => [s.id, s.bloub])) as Record<
  AgentState,
  StateId
>;

// Seconds of engine time to keep drawing after entering a state. Thinking and working loop.
const SETTLE: Record<AgentState, number> = {
  idle: 0.5,
  thinking: Infinity,
  working: Infinity,
  waiting: 0.6,
  done: 0.4,
  blocked: 2.1,
  sleeping: 0.6,
};
const ORBIT_FOR = 3.7;
const ORBIT_GAP = 1.6;

// Crème disappears on the light page; encre follows the theme so it shows in dark mode too.
const PALETTE = COLORS.filter((c) => c.id !== "creme").map((c) =>
  c.id === "encre" ? "var(--color-foreground)" : c.hex,
);

function hash(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function agentSkin(seed: string) {
  const h = hash(seed);
  return { shape: SHAPES[h % SHAPES.length]!, ink: PALETTE[(h >>> 8) % PALETTE.length]! };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function markup(f: BotFrame, ink: string, uid: string, half: number) {
  const box = `x="${-half}" y="${-half}" width="${half * 2}" height="${half * 2}"`;
  const dot = (d: BotFrame["dots"][number]) => {
    const fill = d.color ? `fill="${d.color}"` : `style="fill:${ink}"`;
    return d.d
      ? `<path d="${d.d}" ${fill} opacity="${d.opacity}" transform="translate(${r1(d.x)} ${r1(d.y)}) rotate(${d.rot ?? 0}) scale(${RAYON})"/>`
      : `<circle cx="${r1(d.x)}" cy="${r1(d.y)}" r="${r1(d.r)}" ${fill} opacity="${d.opacity}"/>`;
  };
  const dots = f.dots.map(dot).join("");
  const arcs = (side: "back" | "front") =>
    f.arcs
      .map(
        (a) =>
          `<path d="${a[side]}" stroke="url(#${uid}-${a.id})" stroke-width="${a.width}" opacity="${a.opacity}"/>`,
      )
      .join("");
  const grads = f.arcs
    .map(
      (a) =>
        `<linearGradient id="${uid}-${a.id}" gradientUnits="userSpaceOnUse" x1="${a.grad.x1}" y1="${a.grad.y1}" x2="${a.grad.x2}" y2="${a.grad.y2}">${a.grad.stops
          .map((c, i) => `<stop offset="${i / (a.grad.stops.length - 1)}" stop-color="${c}"/>`)
          .join("")}</linearGradient>`,
    )
    .join("");
  const eyes = f.eyes
    .map((e) => `<path d="${e.d}" transform="${e.matrix}" opacity="${e.alpha}" fill="#000"/>`)
    .join("");
  const notch = f.notch
    ? `<circle cx="${r1(f.notch.x)}" cy="${r1(f.notch.y)}" r="${r1(f.notch.r)}" fill="#000"/>`
    : "";
  const notif = f.notif
    ? `<circle cx="${r1(f.notif.x)}" cy="${r1(f.notif.y)}" r="${r1(f.notif.r)}" fill="${NOTIF_BLUE}"/>`
    : "";
  return (
    `<defs><mask id="${uid}-m" maskUnits="userSpaceOnUse" ${box}><path d="${f.bodyPath}" fill="#fff"/>${eyes}${notch}</mask>${grads}</defs>` +
    `<g fill="none" stroke-linecap="round">${arcs("back")}</g>` +
    (f.dotsBehind ? dots : "") +
    `<g opacity="${f.bodyAlpha}"><path d="${f.bodyPath}" style="fill:var(--color-background)"/>` +
    `<g mask="url(#${uid}-m)"><rect ${box} style="fill:${ink}"/></g></g>` +
    (f.dotsBehind ? "" : dots) +
    notif +
    `<g fill="none" stroke-linecap="round">${arcs("front")}</g>`
  );
}

interface Aim {
  nx: number;
  ny: number;
}

// One rAF loop for every avatar. An avatar draws only while it is awake: during a state
// change, a looping state, a look, or a short rest burst. Between those it is a still SVG.
class Avatar {
  engine: BotEngine;
  clock: number;
  awakeUntil: number;
  phaseAt = 0;
  visible = true;
  aim: Aim | null = null;
  aimSince = 0;
  aiming = false;
  last = 0;
  drawn = "";
  restTimer = 0;

  constructor(
    public svg: SVGSVGElement,
    public state: AgentState,
    public ink: string,
    radii: number[],
    public uid: string,
    public half: number,
    public lively: boolean,
  ) {
    this.clock = POSES[BLOUB[state]];
    this.engine = new BotEngine(RAYON, BLOUB[state], radii, face(state));
    this.awakeUntil = SETTLE[state] === Infinity ? Infinity : this.clock;
  }

  setState(state: AgentState) {
    if (state === this.state) return;
    this.state = state;
    this.phaseAt = this.clock;
    this.engine.setState(BLOUB[state], this.clock);
    this.engine.setExpression(face(state), this.clock);
    this.awakeUntil = this.clock + Math.max(SETTLE[state], BotEngine.SHAPE_MORPH);
    this.wake();
  }

  // Small avatars skip ahead to bloub's next blink and draw just that: drift is invisible
  // at 32px, a blink is not.
  nextBlink() {
    for (let t = this.clock + 0.5; t < this.clock + 8; t += 0.02) {
      if (liveliness(t).lid < 1) return t - 0.02;
    }
    return this.clock;
  }

  wake(forSeconds = 0) {
    this.awakeUntil = Math.max(this.awakeUntil, this.clock + forSeconds);
    if (this.visible) awake.add(this);
    if (raf === 0) raf = requestAnimationFrame(tick);
  }

  scheduleRest() {
    window.clearTimeout(this.restTimer);
    const [lo, hi] = this.lively ? [2, 5] : [6, 12];
    this.restTimer = window.setTimeout(
      () => {
        if (this.lively) this.wake(1.8);
        else if (this.awakeUntil <= this.clock) {
          this.clock = this.nextBlink();
          this.wake(0.24);
        }
        this.scheduleRest();
      },
      (lo + Math.random() * (hi - lo)) * 1000,
    );
  }

  stop() {
    window.clearTimeout(this.restTimer);
    awake.delete(this);
    this.last = 0;
  }

  lookAt(aim: Aim | null) {
    this.aim = aim;
    this.wake(aim ? 0.4 : TURN_TIME);
  }

  // Bloub steers the gaze only on rest-face states; elsewhere the gaze is the animation.
  steer() {
    const restFace = STATE_BY_ID.get(this.engine.state)?.baseFace === true;
    if (!this.aim || !restFace) {
      if (this.aiming) this.engine.setLook(null, this.clock, TURN_TIME);
      this.aiming = false;
      return;
    }
    if (!this.aiming) this.aimSince = this.clock;
    this.aiming = true;
    const look = lookTarget({
      nx: this.aim.nx,
      ny: this.aim.ny,
      tour: easings.easeOutQuint(clamp((this.clock - this.aimSince) / TURN_TIME)),
      pointer: true,
    });
    // Bloub turns towards its side panel; an avatar looks straight at the pointer.
    this.engine.setLook({ ...look, yaw: look.yaw + TURN, spin: 0 }, this.clock);
    this.awakeUntil = Math.max(this.awakeUntil, this.clock + 0.3);
  }

  cycle() {
    if (this.state !== "working") return;
    const since = this.clock - this.phaseAt;
    if (this.engine.state === "orbit" && since > ORBIT_FOR) {
      this.engine.setState("idle", this.clock);
      this.phaseAt = this.clock;
    } else if (this.engine.state === "idle" && since > ORBIT_GAP) {
      this.engine.setState("orbit", this.clock);
      this.phaseAt = this.clock;
    }
  }

  draw() {
    const next = markup(this.engine.sample(this.clock), this.ink, this.uid, this.half);
    if (next !== this.drawn) this.svg.innerHTML = next;
    this.drawn = next;
  }

  frame(ms: number) {
    const dt = this.last ? Math.min((ms - this.last) / 1000, 0.064) : 0;
    this.last = ms;
    this.clock += dt;
    this.cycle();
    this.steer();
    this.draw();
    if (this.clock < this.awakeUntil) return true;
    this.last = 0;
    return false;
  }
}

const awake = new Set<Avatar>();
let raf = 0;

function tick(ms: number) {
  raf = 0;
  for (const a of awake) if (!a.frame(ms)) awake.delete(a);
  if (awake.size > 0) raf = requestAnimationFrame(tick);
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Bloub({
  seed,
  state = "idle",
  className,
  roomy,
  followPointer,
  lively,
}: {
  seed: string;
  state?: AgentState;
  className?: string;
  /** Full bloub canvas, with room for the orbit rings. Avatars crop closer to the body. */
  roomy?: boolean;
  /** Tracks the pointer anywhere on the page instead of only while hovered. */
  followPointer?: boolean;
  /** Rest bursts (blinks, drift) every few seconds instead of every ten or so. */
  lively?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const avatar = useRef<Avatar | null>(null);
  const latestState = useRef(state);
  const uid = `bl${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const half = roomy ? DEMI_VIEWBOX : 124;
  const skin = agentSkin(seed);
  const [initial] = useState(() =>
    markup(
      new BotEngine(RAYON, BLOUB[state], skin.shape.radii, face(state)).sample(POSES[BLOUB[state]]),
      skin.ink,
      uid,
      half,
    ),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the imperative avatar and the viewport observer to the mounted SVG
  useEffect(() => {
    const el = svg.current;
    if (!el || reducedMotion()) return;
    const { shape, ink } = agentSkin(seed);
    const a = new Avatar(el, latestState.current, ink, shape.radii, uid, half, lively === true);
    avatar.current = a;
    const observer = new IntersectionObserver(([entry]) => {
      a.visible = entry?.isIntersecting ?? true;
      if (!a.visible) {
        a.stop();
        return;
      }
      a.wake();
      a.scheduleRest();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      a.visible = false;
      a.stop();
      avatar.current = null;
    };
  }, [seed, uid, half, lively]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the state prop into the imperative avatar, which owns timing
  useEffect(() => {
    latestState.current = state;
    avatar.current?.setState(state);
  }, [state]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- page-wide pointer tracking for showcase avatars
  useEffect(() => {
    const el = svg.current;
    if (!followPointer || !el) return;
    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || event.pointerType === "touch") return;
      avatar.current?.lookAt({
        nx: clamp((event.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2), -1, 1),
        ny: clamp((event.clientY - (box.top + box.height / 2)) / (window.innerHeight / 2), -1, 1),
      });
    };
    const onLeave = () => avatar.current?.lookAt(null);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [followPointer]);

  const hover = followPointer
    ? {}
    : {
        onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (box.width === 0 || event.pointerType === "touch") return;
          avatar.current?.lookAt({
            nx: clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1, 1),
            ny: clamp(((event.clientY - box.top) / box.height) * 2 - 1, -1, 1),
          });
        },
        onPointerLeave: () => avatar.current?.lookAt(null),
      };

  return (
    <svg
      ref={svg}
      viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={seed}
      // Frames are written imperatively; React only seeds the first one.
      dangerouslySetInnerHTML={{ __html: initial }}
      {...hover}
    />
  );
}
