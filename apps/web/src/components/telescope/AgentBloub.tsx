import type { AgentActivity } from "@t3tools/client-runtime/telescope/agents";
import { useEffect, useId, useRef, useState } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { NOTIF_BLUE } from "../../vendor/bloub/decor";
import { BotEngine, type BotFrame } from "../../vendor/bloub/engine";
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from "../../vendor/bloub/expressions";
import { liveliness } from "../../vendor/bloub/face";
import { TURN, TURN_TIME, lookTarget } from "../../vendor/bloub/gaze";
import { clamp, easings } from "../../vendor/bloub/math";
import { RAYON } from "../../vendor/bloub/repere";
import { COLORS, SHAPES } from "../../vendor/bloub/skins";
import { POSES, STATE_BY_ID, type StateId } from "../../vendor/bloub/states";

const BLOUB: Record<AgentActivity, StateId> = {
  idle: "idle",
  working: "orbit",
  waiting: "notify",
  blocked: "alert",
};
// Seconds a state change plays before the avatar holds still; working lands on its clearest pose.
const SETTLE: Record<AgentActivity, number> = {
  idle: 0.5,
  working: 1.2,
  waiting: 0.6,
  blocked: 2.1,
};
const ORBIT_FOR = 3.7;
const ORBIT_GAP = 1.6;
export const LOOP_CAP = 6;
const HALF = 124;
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
type Skin = ReturnType<typeof agentSkin>;

const r1 = (n: number) => Math.round(n * 10) / 10;

function markup(f: BotFrame, ink: string, uid: string) {
  const box = `x="${-HALF}" y="${-HALF}" width="${HALF * 2}" height="${HALF * 2}"`;
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

function stillFrame(activity: AgentActivity, skin: Skin, uid: string) {
  const id = BLOUB[activity];
  const engine = new BotEngine(RAYON, id, skin.shape.radii, FACE);
  return markup(engine.sample(POSES[id]), skin.ink, uid);
}

interface Aim {
  nx: number;
  ny: number;
}

const awake = new Set<Avatar>();
const loopers = new Set<Avatar>();
const queued = new Set<Avatar>();
let raf = 0;

function run() {
  if (raf === 0 && awake.size > 0 && !document.hidden) raf = requestAnimationFrame(tick);
}

function tick(ms: number) {
  raf = 0;
  if (document.hidden) return;
  for (const a of awake) if (!a.frame(ms)) awake.delete(a);
  run();
}

// The desktop app keeps rendering hidden windows, so a hidden page stops the loop itself.
document.addEventListener("visibilitychange", run);

// One rAF loop for every avatar. An avatar draws only while a state change, a look or its
// working loop plays; the rest of the time it is a still SVG and no frame runs.
class Avatar {
  readonly engine: BotEngine;
  clock: number;
  until: number;
  phaseAt: number;
  onScreen = false;
  aim: Aim | null = null;
  aimSince = 0;
  aiming = false;
  last = 0;

  constructor(
    readonly svg: SVGSVGElement,
    public activity: AgentActivity,
    readonly skin: Skin,
    readonly uid: string,
    readonly motion: boolean,
    public drawn: string,
  ) {
    const id = BLOUB[activity];
    this.clock = POSES[id];
    this.until = this.clock;
    this.phaseAt = this.clock;
    this.engine = new BotEngine(RAYON, id, skin.shape.radii, FACE);
    this.draw();
  }

  setActivity(next: AgentActivity) {
    if (next === this.activity) return;
    this.activity = next;
    if (!this.motion) {
      this.engine.reset(BLOUB[next], 0);
      this.clock = POSES[BLOUB[next]];
      this.draw();
      return;
    }
    this.phaseAt = this.clock;
    this.engine.setState(BLOUB[next], this.clock);
    this.until = this.clock + SETTLE[next];
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
      if (!looping) this.until = this.clock + SETTLE.working;
    }
  }

  draw() {
    const next = markup(this.engine.sample(this.clock), this.skin.ink, this.uid);
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
    // Never hold still mid-blink.
    if (this.clock < this.until || loopers.has(this) || liveliness(this.clock).lid < 1) return true;
    this.last = 0;
    return false;
  }
}

/** The bloub engine's avatar for one agent, loaded on demand by AgentAvatar. */
export default function AgentBloub({
  seed,
  activity,
  className,
}: {
  seed: string;
  activity: AgentActivity;
  className?: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const avatar = useRef<Avatar | null>(null);
  const latest = useRef(activity);
  const uid = `bl${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  // React writes only the first frame; the avatar writes every later one.
  const [initial] = useState(() => stillFrame(activity, agentSkin(seed), uid));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the imperative avatar and its viewport observer to the mounted SVG
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const a = new Avatar(el, latest.current, agentSkin(seed), uid, !reduced, initial);
    avatar.current = a;
    const observer = new IntersectionObserver(([entry]) => {
      a.onScreen = entry?.isIntersecting ?? false;
      a.fit();
      if (a.onScreen) a.wake();
      else a.rest();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      a.onScreen = false;
      a.fit();
      a.rest();
      avatar.current = null;
    };
  }, [seed, uid, reduced, initial]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the activity into the imperative avatar, which owns timing
  useEffect(() => {
    latest.current = activity;
    avatar.current?.setActivity(activity);
  }, [activity]);

  return (
    <svg
      ref={svg}
      viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`}
      className={cn("shrink-0", className)}
      aria-hidden
      data-activity={activity}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (box.width === 0 || event.pointerType === "touch") return;
        avatar.current?.lookAt({
          nx: clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1, 1),
          ny: clamp(((event.clientY - box.top) / box.height) * 2 - 1, -1, 1),
        });
      }}
      onPointerLeave={() => avatar.current?.lookAt(null)}
      dangerouslySetInnerHTML={{ __html: initial }}
    />
  );
}
