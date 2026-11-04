// PROTOTYPE, wipe me. Floating Telescope / Focus / Microscope switch at the top centre of the app
// (the Lighthouse and Code modes, with focus mode between them). It rests as a faint capsule and morphs into a two-icon switch when
// the pointer comes near. Pure CSS hover, so nothing animates while the pointer is elsewhere.
import { useNavigate } from "@tanstack/react-router";
import { useId, type CSSProperties, type SVGProps } from "react";

import { cn } from "../../lib/utils";
import { FocusMode } from "./FocusMode";
import { openFocusPicker } from "./focusStore";
import { useLighthouseSearch } from "./lighthouseLocation";

// Hover animations are scoped to each segment's own group, so they run only while that segment is
// under the pointer (or keyboard focus) and stop the moment it leaves.

const TUBE = { transformBox: "view-box", transformOrigin: "10px 12.5px" } as const;
const LENS = { transformBox: "view-box", transformOrigin: "21.5px 12.5px" } as const;

// Monochrome telescope on a tripod. Live, the tube dips low, sweeps up high and the lens flares.
function TelescopeGlyph({ live, ...props }: SVGProps<SVGSVGElement> & { live?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <g transform="rotate(-20 10 12.5)">
        <g
          style={TUBE}
          className={cn(
            live &&
              "motion-safe:group-hover/tele:animate-telescope-sweep motion-safe:group-focus-visible/tele:animate-telescope-sweep",
          )}
        >
          <path d="M1.6 11.6h1.6v1.8H1.6z" />
          <path d="m3.2 11.2 15.4-1.1v4.8l-15.4-1.1z" />
          <path d="M18.6 9.6h2.9v5.8h-2.9z" />
          <path d="M6.8 9.4h4v1.1h-4z" />
          {live ? (
            <circle
              cx="21.5"
              cy="12.5"
              r="1.2"
              style={LENS}
              className="opacity-0 motion-safe:group-hover/tele:animate-telescope-glint motion-safe:group-focus-visible/tele:animate-telescope-glint"
            />
          ) : null}
        </g>
      </g>
      <path d="M9.1 13.4h1.8v2.2H9.1z" />
      <path
        d="M10 15.2 5.3 22M10 15.2l4.7 6.8M10 15.2V22"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </svg>
  );
}

// The glare reaching the "camera" at the top of the sweep. Drawn outside the island so the
// island's clipping does not cut it; anchored where the lens is at that moment.
const FLARE_RUN = "motion-safe:group-has-[[data-tele]:hover]/island:opacity-100";
function TelescopeFlare() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-1/2 left-1/2 -mt-2 -ms-39.25 size-0 opacity-0",
        FLARE_RUN,
        "motion-safe:group-has-[[data-tele]:focus-visible]/island:opacity-100",
      )}
    >
      <span className="absolute size-24 -translate-1/2 rounded-full bg-radial from-zinc-25 from-0% via-muted-foreground/35 via-30% to-transparent to-65% opacity-0 motion-safe:group-has-[[data-tele]:hover]/island:animate-telescope-bloom motion-safe:group-has-[[data-tele]:focus-visible]/island:animate-telescope-bloom" />
      <span className="absolute h-0.5 w-28 -translate-1/2 rounded-full bg-linear-to-r from-transparent via-zinc-25 to-transparent opacity-0 drop-shadow-sm motion-safe:group-has-[[data-tele]:hover]/island:animate-telescope-streak motion-safe:group-has-[[data-tele]:focus-visible]/island:animate-telescope-streak" />
      <span className="absolute left-26 size-5 -translate-1/2 rounded-full border border-muted-foreground/40 bg-zinc-25/20 opacity-0 motion-safe:group-has-[[data-tele]:hover]/island:animate-telescope-ghost motion-safe:group-has-[[data-tele]:focus-visible]/island:animate-telescope-ghost" />
      <span className="absolute left-36 size-2.5 -translate-1/2 rounded-full bg-muted-foreground/30 opacity-0 motion-safe:group-has-[[data-tele]:hover]/island:animate-telescope-ghost motion-safe:group-has-[[data-tele]:focus-visible]/island:animate-telescope-ghost" />
      <span className="absolute left-46 size-6 -translate-1/2 rounded-full bg-radial from-transparent from-50% via-muted-foreground/30 via-65% to-transparent to-75% opacity-0 motion-safe:group-has-[[data-tele]:hover]/island:animate-telescope-ghost motion-safe:group-has-[[data-tele]:focus-visible]/island:animate-telescope-ghost" />
    </span>
  );
}

const LENS_VIEW = { transformBox: "view-box", transformOrigin: "12px 12.5px" } as const;

// Rows of token blocks inside the lens; the last row stops part way, as if still generating.
const STREAM_ROWS = [
  { x: 1, y: 1.8, widths: [5, 3, 6, 4] },
  { x: -1, y: 6.3, widths: [4, 7, 3, 5, 4] },
  { x: -2, y: 10.8, widths: [6, 2, 5, 8, 3] },
  { x: -1, y: 15.3, widths: [3, 6, 4, 5, 4] },
  { x: 0, y: 19.8, widths: [5, 4, 6] },
];
const STREAM_START_MS = 420;
const STREAM_STEP_MS = 38;
const STREAM_TOKENS = STREAM_ROWS.flatMap((row, rowIndex) => {
  let x = row.x;
  return row.widths.map((width, index) => {
    const token = {
      key: `${rowIndex}-${index}`,
      x,
      y: row.y,
      width,
      opacity: (rowIndex + index) % 3 === 0 ? 0.55 : 0.9,
    };
    x += width + 1;
    return token;
  });
}).map((token, index) => ({ ...token, delay: STREAM_START_MS + index * STREAM_STEP_MS }));

// Monochrome microscope. Live, the objective drops onto the slide, then a magnified lens view
// opens on top of the whole icon with a dark vignette, streams token rows for about 0.8s and shrinks back.
function MicroscopeGlyph({
  live,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { live?: boolean }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("overflow-visible", className)}
      {...props}
    >
      <g
        className={cn(
          live &&
            "motion-safe:group-hover/micro:animate-microscope-hide motion-safe:group-focus-visible/micro:animate-microscope-hide",
        )}
      >
        <g
          className={cn(
            live &&
              "motion-safe:group-hover/micro:animate-microscope-tube motion-safe:group-focus-visible/micro:animate-microscope-tube",
          )}
        >
          <path d="M7.9 1.8h3.2v1.6H7.9z" />
          <path d="M8.4 3.4h2.2V10H8.4z" />
          <path d="M8.9 10h1.2v2.2H8.9z" />
        </g>
        <path d="M10.6 6.6H13v1.6h-2.4z" />
        <path
          d="M15.2 20.2v-6.4c0-2.6-1-4.6-2.6-5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
        />
        <path d="M5.5 15.6h9.5v1.1H5.5z" />
        <rect x="5" y="20" width="14" height="2" rx="1" />
      </g>
      {live ? (
        <g
          style={LENS_VIEW}
          className={cn(
            "opacity-0",
            "motion-safe:group-hover/micro:animate-microscope-lens motion-safe:group-focus-visible/micro:animate-microscope-lens",
          )}
        >
          <defs>
            <radialGradient id={`${id}-vignette`}>
              <stop offset="0.6" stopOpacity={0} />
              <stop offset="0.68" stopOpacity={0.92} />
              <stop offset="0.84" stopOpacity={0.6} />
              <stop offset="1" stopOpacity={0} />
            </radialGradient>
            <radialGradient id={`${id}-rim`}>
              <stop offset="0.6" stopOpacity={0} />
              <stop offset="1" stopOpacity={0.45} />
            </radialGradient>
            <clipPath id={`${id}-lens`}>
              <circle cx="12" cy="12.5" r="16" />
            </clipPath>
          </defs>
          <circle cx="12" cy="12.5" r="24" fill={`url(#${id}-vignette)`} />
          <g clipPath={`url(#${id}-lens)`}>
            <circle cx="12" cy="12.5" r="16" fillOpacity={0.12} />
            <g
              style={LENS_VIEW}
              className="motion-safe:group-hover/micro:animate-microscope-detail motion-safe:group-focus-visible/micro:animate-microscope-detail"
            >
              {STREAM_TOKENS.map((token) => (
                <rect
                  key={token.key}
                  x={token.x}
                  y={token.y}
                  width={token.width}
                  height={2.4}
                  rx={1.2}
                  fillOpacity={token.opacity}
                  style={{
                    animationDelay: `${token.delay}ms`,
                    transformBox: "fill-box",
                    transformOrigin: "left center",
                  }}
                  className="opacity-0 motion-safe:group-hover/micro:animate-microscope-token motion-safe:group-focus-visible/micro:animate-microscope-token"
                />
              ))}
            </g>
            <circle cx="12" cy="12.5" r="16" fill={`url(#${id}-rim)`} />
          </g>
          <circle cx="12" cy="12.5" r="16" fill="none" stroke="currentColor" strokeWidth={1.4} />
        </g>
      ) : null}
    </svg>
  );
}

// Each letter of "Focus" (and the target's dot) fidgets along its own path, then settles in line:
// restless first, focused at the end. One shot per hover.
const FIDGET = [
  ["-1px", "-3px", "-12deg", "2px", "1px", "9deg", "-2px", "2px", "-6deg", "1px", "-2px", "8deg"],
  ["2px", "2px", "10deg", "-1px", "-3px", "-8deg", "2px", "-1px", "12deg", "-2px", "1px", "-5deg"],
  ["-2px", "1px", "-8deg", "1px", "3px", "14deg", "-1px", "-2px", "-10deg", "2px", "2px", "6deg"],
  ["1px", "-2px", "14deg", "-2px", "2px", "-6deg", "2px", "3px", "8deg", "-1px", "-3px", "-12deg"],
  ["-1px", "3px", "-6deg", "2px", "-2px", "12deg", "-2px", "1px", "-14deg", "1px", "-1px", "9deg"],
];
const fidget = (i: number, delay: number) => {
  const v = FIDGET[i % FIDGET.length]!;
  return {
    "--ax": v[0],
    "--ay": v[1],
    "--ar": v[2],
    "--bx": v[3],
    "--by": v[4],
    "--br": v[5],
    "--cx": v[6],
    "--cy": v[7],
    "--cr": v[8],
    "--dx": v[9],
    "--dy": v[10],
    "--dr": v[11],
    animationDelay: `${delay}ms`,
  } as CSSProperties;
};
const FIDGET_RUN =
  "motion-safe:group-hover/focus:animate-focus-fidget motion-safe:group-focus-visible/focus:animate-focus-fidget";

function FocusGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.5" strokeWidth={1.8} />
      <path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5" strokeWidth={1.8} strokeLinecap="round" />
      <circle
        cx="12"
        cy="12"
        r="2.6"
        fill="currentColor"
        stroke="none"
        style={{ ...fidget(3, 0), transformBox: "fill-box", transformOrigin: "center" }}
        className={FIDGET_RUN}
      />
    </svg>
  );
}

const FOCUS_LETTERS = [..."Focus"].map((ch, i) => ({
  ch,
  id: `${ch}${i}`,
  style: fidget(i, i * 25),
}));

function FidgetLabel() {
  return (
    <span aria-label="Focus" className="inline-flex">
      {FOCUS_LETTERS.map(({ ch, id, style }) => (
        <span key={id} aria-hidden="true" style={style} className={cn("inline-block", FIDGET_RUN)}>
          {ch}
        </span>
      ))}
    </span>
  );
}

export function LighthouseIsland() {
  const navigate = useNavigate();
  const onWork = useLighthouseSearch() !== null;
  const Current = onWork ? TelescopeGlyph : MicroscopeGlyph;
  const modes = [
    {
      id: "work",
      label: "Telescope",
      active: onWork,
      go: () =>
        void navigate({
          to: "/prototype/lighthouse",
          search: { as: "admin", chat: "mine", view: "chats" },
        }),
    },
    {
      id: "focus",
      label: "Focus",
      active: false,
      go: openFocusPicker,
    },
    {
      id: "code",
      label: "Microscope",
      active: !onWork,
      go: () => void navigate({ to: "/" }),
    },
  ];

  return (
    <>
      {/* Outside the island: its translate would make the full-screen page relative to it. */}
      <FocusMode />
      {/* The wrapper is the "near" zone: larger than the resting capsule, so the island opens
    before the pointer is on it. */}
      <div className="group/island fixed top-(--workspace-controls-top) left-1/2 z-50 flex h-(--workspace-topbar-height) w-104 -translate-x-1/2 items-center justify-center [-webkit-app-region:no-drag]">
        <div
          role="group"
          aria-label="Telescope, Focus or Microscope"
          className={cn(
            "relative flex h-6 w-14 items-center justify-center overflow-hidden rounded-full border border-transparent bg-foreground/85 opacity-45 shadow-sm",
            "transition-[width,height,border-radius,background-color,opacity,box-shadow] duration-300 ease-out motion-reduce:transition-none",
            "group-hover/island:h-11 group-hover/island:w-96 group-hover/island:rounded-2xl group-hover/island:border-border group-hover/island:bg-popover/90 group-hover/island:opacity-100 group-hover/island:shadow-xl group-hover/island:backdrop-blur-xl",
            "group-has-[:focus-visible]/island:h-11 group-has-[:focus-visible]/island:w-96 group-has-[:focus-visible]/island:rounded-2xl group-has-[:focus-visible]/island:border-border group-has-[:focus-visible]/island:bg-popover/90 group-has-[:focus-visible]/island:opacity-100 group-has-[:focus-visible]/island:shadow-xl",
          )}
        >
          <Current
            className={cn(
              "absolute size-3.5 text-background transition-[opacity,scale] duration-200 motion-reduce:transition-none",
              "group-hover/island:scale-50 group-hover/island:opacity-0 group-has-[:focus-visible]/island:scale-50 group-has-[:focus-visible]/island:opacity-0",
            )}
          />
          <div
            className={cn(
              "relative grid h-9 w-94 shrink-0 scale-75 grid-cols-3 p-0 opacity-0 transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none",
              "pointer-events-none group-hover/island:pointer-events-auto group-hover/island:scale-100 group-hover/island:opacity-100",
              "group-has-[:focus-visible]/island:pointer-events-auto group-has-[:focus-visible]/island:scale-100 group-has-[:focus-visible]/island:opacity-100",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-0 left-0 w-1/3 rounded-xl bg-foreground shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none",
                onWork ? "translate-x-0" : "translate-x-[200%]",
              )}
            />
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                data-tele={m.id === "work" ? "" : undefined}
                aria-pressed={m.id === "focus" ? undefined : m.active}
                onClick={m.active ? undefined : m.go}
                className={cn(
                  "relative z-10 flex items-center justify-center gap-2 rounded-xl text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  m.id === "work" ? "group/tele" : m.id === "focus" ? "group/focus" : "group/micro",
                  m.active
                    ? "cursor-default text-background"
                    : "cursor-pointer text-muted-foreground hover:text-foreground",
                )}
              >
                {m.id === "work" ? (
                  <TelescopeGlyph className="relative size-4.5" live />
                ) : m.id === "focus" ? (
                  <FocusGlyph className="relative size-4.5" />
                ) : (
                  <MicroscopeGlyph className="relative size-4.5" live />
                )}
                {m.id === "focus" ? <FidgetLabel /> : m.label}
              </button>
            ))}
          </div>
        </div>
        <TelescopeFlare />
      </div>
    </>
  );
}
