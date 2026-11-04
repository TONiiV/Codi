// PROTOTYPE, wipe me. Floating Telescope / Microscope switch at the top centre of the app (the
// Lighthouse and Code modes). It rests as a faint capsule and morphs into a two-icon switch when
// the pointer comes near. Pure CSS hover, so nothing animates while the pointer is elsewhere.
import { useNavigate } from "@tanstack/react-router";
import type { SVGProps } from "react";

import { cn } from "../../lib/utils";
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
        "pointer-events-none absolute top-1/2 left-1/2 -mt-2 -ms-23.5 size-0 opacity-0",
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

const SPECIMEN = { transformBox: "view-box", transformOrigin: "9.5px 15px" } as const;

// Monochrome microscope. Live, the objective drops onto the slide, a focus ring zooms into the
// detail, then shrinks back and the icon comes to rest.
function MicroscopeGlyph({
  live,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { live?: boolean }) {
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
      {live ? (
        <g
          style={SPECIMEN}
          className="opacity-0 motion-safe:group-hover/micro:animate-microscope-focus motion-safe:group-focus-visible/micro:animate-microscope-focus"
        >
          <circle cx="9.5" cy="15" r="2.2" fill="none" stroke="currentColor" strokeWidth={0.35} />
          <circle cx="8.8" cy="14.6" r="0.35" />
          <circle cx="10.1" cy="15.4" r="0.25" />
          <circle cx="9.9" cy="14.3" r="0.2" />
        </g>
      ) : null}
    </svg>
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
      id: "code",
      label: "Microscope",
      active: !onWork,
      go: () => void navigate({ to: "/" }),
    },
  ];

  return (
    // The wrapper is the "near" zone: larger than the resting capsule, so the island opens
    // before the pointer is on it.
    <div className="group/island fixed top-(--workspace-controls-top) left-1/2 z-50 flex h-(--workspace-topbar-height) w-80 -translate-x-1/2 items-center justify-center [-webkit-app-region:no-drag]">
      <div
        role="group"
        aria-label="Telescope or Microscope"
        className={cn(
          "relative flex h-6 w-14 items-center justify-center overflow-hidden rounded-full border border-transparent bg-foreground/85 opacity-45 shadow-sm",
          "transition-[width,height,border-radius,background-color,opacity,box-shadow] duration-300 ease-out motion-reduce:transition-none",
          "group-hover/island:h-11 group-hover/island:w-64 group-hover/island:rounded-2xl group-hover/island:border-border group-hover/island:bg-popover/90 group-hover/island:opacity-100 group-hover/island:shadow-xl group-hover/island:backdrop-blur-xl",
          "group-has-[:focus-visible]/island:h-11 group-has-[:focus-visible]/island:w-64 group-has-[:focus-visible]/island:rounded-2xl group-has-[:focus-visible]/island:border-border group-has-[:focus-visible]/island:bg-popover/90 group-has-[:focus-visible]/island:opacity-100 group-has-[:focus-visible]/island:shadow-xl",
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
            "relative grid h-9 w-62 shrink-0 scale-75 grid-cols-2 p-0 opacity-0 transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none",
            "pointer-events-none group-hover/island:pointer-events-auto group-hover/island:scale-100 group-hover/island:opacity-100",
            "group-has-[:focus-visible]/island:pointer-events-auto group-has-[:focus-visible]/island:scale-100 group-has-[:focus-visible]/island:opacity-100",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 left-0 w-1/2 rounded-xl bg-foreground shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none",
              onWork ? "translate-x-0" : "translate-x-full",
            )}
          />
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              data-tele={m.id === "work" ? "" : undefined}
              aria-pressed={m.active}
              onClick={m.active ? undefined : m.go}
              className={cn(
                "relative z-10 flex items-center justify-center gap-2 rounded-xl text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                m.id === "work" ? "group/tele" : "group/micro",
                m.active
                  ? "cursor-default text-background"
                  : "cursor-pointer text-muted-foreground hover:text-foreground",
              )}
            >
              {m.id === "work" ? (
                <TelescopeGlyph className="relative size-4.5" live />
              ) : (
                <MicroscopeGlyph className="relative size-4.5" live />
              )}
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <TelescopeFlare />
    </div>
  );
}
