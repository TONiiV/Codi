// oxlint-disable unicorn/no-array-fill-with-reference-type -- ctx.fill(path) draws; it is not Array.fill
import type { AgentActivity } from "@t3tools/client-runtime/telescope/agents";
import { useLayoutEffect, useRef } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { NOTIF_BLUE } from "../../vendor/bloub/decor";
import { BotEngine, type BotFrame } from "../../vendor/bloub/engine";
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from "../../vendor/bloub/expressions";
import { liveliness } from "../../vendor/bloub/face";
import { TURN, TURN_TIME, lookTarget } from "../../vendor/bloub/gaze";
import { clamp, easings } from "../../vendor/bloub/math";
import { RAYON } from "../../vendor/bloub/repere";
import { COLORS, SHAPES } from "../../vendor/bloub/skins";
import { POSES, STATE_BY_ID, type StateId } from "../../vendor/bloub/states";

// The bloub state per activity, and the seconds its change plays before the avatar holds still.
const BLOUB: Record<AgentActivity, readonly [StateId, number]> = {
  idle: ["idle", 0.5],
  working: ["orbit", 1.2],
  waiting: ["notify", 0.6],
  blocked: ["alert", 2.1],
};
const ORBIT_FOR = 3.7;
const ORBIT_GAP = 1.6;
export const LOOP_CAP = 6;
const FPS = 24;
const HALF = 124;
const PAPER = "var(--color-background)";
const FACE = EXPRESSION_BY_ID.get(DEFAULT_EXPRESSION) ?? null;

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

export function agentSkin(seed: string) {
  const h = hash(seed);
  return { shape: SHAPES[h % SHAPES.length]!, ink: PALETTE[(h >>> 8) % PALETTE.length]! };
}

function paint(ctx: CanvasRenderingContext2D, f: BotFrame, ink: string, paper: string) {
  const k = ctx.canvas.width / (HALF * 2);
  ctx.setTransform(k, 0, 0, k, HALF * k, HALF * k);
  ctx.clearRect(-HALF, -HALF, HALF * 2, HALF * 2);
  ctx.lineCap = "round";
  const disc = (c: { x: number; y: number; r: number }, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
  };
  const arcs = (side: "back" | "front") => {
    for (const a of f.arcs) {
      const { x1, y1, x2, y2, stops } = a.grad;
      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
      ctx.globalAlpha = a.opacity;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = a.width;
      ctx.stroke(new Path2D(a[side]));
    }
  };
  const dots = () => {
    for (const dot of f.dots) {
      ctx.globalAlpha = dot.opacity;
      if (!dot.d) disc(dot, dot.color ?? ink);
      else {
        ctx.save();
        ctx.translate(dot.x, dot.y);
        ctx.rotate(((dot.rot ?? 0) * Math.PI) / 180);
        ctx.scale(RAYON, RAYON);
        ctx.fillStyle = dot.color ?? ink;
        ctx.fill(new Path2D(dot.d));
        ctx.restore();
      }
    }
  };
  arcs("back");
  if (f.dotsBehind) dots();
  // The eyes are holes in the ink: the page colour shows through at each eye's alpha.
  const body = new Path2D(f.bodyPath);
  ctx.globalAlpha = f.bodyAlpha;
  ctx.fillStyle = ink;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = paper;
  for (const eye of f.eyes) {
    ctx.save();
    ctx.globalAlpha = f.bodyAlpha * eye.alpha;
    ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix(eye.matrix)));
    ctx.fill(new Path2D(eye.d));
    ctx.restore();
  }
  if (f.notch) disc(f.notch, paper);
  ctx.restore();
  if (!f.dotsBehind) dots();
  ctx.globalAlpha = 1;
  if (f.notif) disc(f.notif, NOTIF_BLUE);
  arcs("front");
}

type Aim = { nx: number; ny: number };

const mounted = new Set<Avatar>();
const awake = new Set<Avatar>();
const loopers = new Set<Avatar>();
const queued = new Set<Avatar>();
let raf = 0;

function run() {
  if (raf === 0 && awake.size > 0 && !document.hidden) raf = requestAnimationFrame(tick);
}

function tick(ms: number) {
  if (!document.hidden) for (const a of awake) if (!a.frame(ms)) awake.delete(a);
  // A timer paces the loop, so the page renders only the frames the avatars draw.
  raf = -1;
  setTimeout(() => {
    raf = 0;
    run();
  }, 1000 / FPS);
}

// The desktop app keeps rendering hidden windows, so a hidden page stops the loop itself.
document.addEventListener("visibilitychange", run);
// Themes change attributes on <html>; a still canvas has to repaint itself in the new colours.
new MutationObserver(() => mounted.forEach((a) => a.draw())).observe(document.documentElement, {
  attributes: true,
});

// One loop for every avatar. An avatar draws only while a state change, a look or its working
// loop plays; the rest of the time its canvas holds the last frame and no frame runs.
class Avatar {
  readonly engine: BotEngine;
  readonly ctx: CanvasRenderingContext2D | null;
  readonly style: CSSStyleDeclaration;
  clock: number;
  until: number;
  phaseAt: number;
  onScreen = false;
  aim: Aim | null = null;
  aimSince = 0;
  aiming = false;
  last = 0;

  constructor(
    canvas: HTMLCanvasElement,
    public activity: AgentActivity,
    radii: (typeof SHAPES)[number]["radii"],
    readonly motion: boolean,
  ) {
    const [id] = BLOUB[activity];
    this.clock = POSES[id];
    this.until = this.clock;
    this.phaseAt = this.clock;
    this.engine = new BotEngine(RAYON, id, radii, FACE);
    this.ctx = canvas.getContext("2d");
    this.style = getComputedStyle(canvas);
    this.draw();
  }

  setActivity(next: AgentActivity) {
    if (next === this.activity) return;
    this.activity = next;
    const [id, settle] = BLOUB[next];
    if (!this.motion) {
      this.engine.reset(id, 0);
      this.clock = POSES[id];
      this.draw();
      return;
    }
    this.phaseAt = this.clock;
    this.engine.setState(id, this.clock);
    this.until = this.clock + settle;
    this.fit();
    this.wake();
  }

  /** Working loops while on screen in one of the free slots; otherwise it holds a still frame. */
  fit() {
    const wants = this.motion && this.onScreen && this.activity === "working";
    if (wants && (loopers.has(this) || loopers.size < LOOP_CAP)) {
      loopers.add(this);
      queued.delete(this);
      return;
    }
    if (wants) queued.add(this);
    else queued.delete(this);
    if (!loopers.delete(this)) return;
    for (const next of queued) {
      if (loopers.size >= LOOP_CAP) break;
      next.fit();
      next.wake();
    }
  }

  wake(seconds = 0) {
    this.until = Math.max(this.until, this.clock + seconds);
    if (!this.motion || !this.onScreen) return;
    awake.add(this);
    run();
  }

  rest() {
    awake.delete(this);
    this.last = 0;
  }

  lookAt(aim: Aim | null) {
    if (!this.motion) return;
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
    this.until = Math.max(this.until, this.clock + 0.3);
  }

  // A looping avatar pauses between orbits; one without a slot goes back to its orbit pose.
  cycle() {
    if (this.activity !== "working") return;
    const since = this.clock - this.phaseAt;
    const looping = loopers.has(this);
    if (this.engine.state === "orbit" && looping && since > ORBIT_FOR) {
      this.engine.setState("idle", this.clock);
      this.phaseAt = this.clock;
    } else if (this.engine.state === "idle" && (!looping || since > ORBIT_GAP)) {
      this.engine.setState("orbit", this.clock);
      this.phaseAt = this.clock;
      if (!looping) this.until = this.clock + BLOUB.working[1];
    }
  }

  draw() {
    if (this.ctx)
      paint(this.ctx, this.engine.sample(this.clock), this.style.color, this.style.outlineColor);
  }

  frame(ms: number) {
    const dt = this.last ? Math.min((ms - this.last) / 1000, 0.1) : 0;
    this.last = ms;
    this.clock += dt;
    this.cycle();
    this.steer();
    this.draw();
    // Never hold still mid-blink.
    if (this.clock < this.until || loopers.has(this) || liveliness(this.clock).lid < 1) return true;
    this.last = 0;
    return false;
  }
}

/** The bloub engine's avatar for one agent, drawn on a canvas and loaded on demand by AgentAvatar. */
export default function AgentBloub(props: { seed: string; activity: AgentActivity; size: number }) {
  const { seed, activity, size } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const avatar = useRef<Avatar | null>(null);
  const latest = useRef(activity);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The canvas reads its colours back from CSS, so they follow the theme.
  const style = { width: size, height: size, color: agentSkin(seed).ink, outlineColor: PAPER };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the imperative avatar and its viewport observer to the mounted canvas before it first shows
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.width = el.height = Math.round(size * window.devicePixelRatio);
    const a = new Avatar(el, latest.current, agentSkin(seed).shape.radii, !reduced);
    avatar.current = a;
    mounted.add(a);
    const observer = new IntersectionObserver(([entry]) => {
      a.onScreen = entry?.isIntersecting ?? false;
      a.fit();
      if (a.onScreen) a.wake();
      else a.rest();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      mounted.delete(a);
      a.onScreen = false;
      a.fit();
      a.rest();
      avatar.current = null;
    };
  }, [seed, reduced, size]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the activity into the imperative avatar, which owns timing
  useLayoutEffect(() => {
    latest.current = activity;
    avatar.current?.setActivity(activity);
  }, [activity]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-activity={activity}
      className="shrink-0"
      style={style}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (box.width === 0 || event.pointerType === "touch") return;
        avatar.current?.lookAt({
          nx: clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1, 1),
          ny: clamp(((event.clientY - box.top) / box.height) * 2 - 1, -1, 1),
        });
      }}
      onPointerLeave={() => avatar.current?.lookAt(null)}
    />
  );
}
