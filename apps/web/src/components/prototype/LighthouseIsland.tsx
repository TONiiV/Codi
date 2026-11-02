// PROTOTYPE, wipe me. Floating Lighthouse / Code switch at the top centre of the app. It rests as a
// faint capsule and morphs into a two-icon switch when the pointer comes near. Pure CSS hover, so
// nothing animates while the pointer is elsewhere.
import { useNavigate } from "@tanstack/react-router";
import type { SVGProps } from "react";

import { cn } from "../../lib/utils";
import { useLighthouseSearch } from "./lighthouseLocation";

// Hover animations are scoped to each segment's own group, so they run only while that segment is
// under the pointer (or keyboard focus) and stop the moment it leaves.

// Monochrome silhouette after the reference: twin beams, lantern, tapered tower with a light slit,
// stepped base on a rock.
function LighthouseGlyph({ live, ...props }: SVGProps<SVGSVGElement> & { live?: boolean }) {
  const pivot = { transformBox: "view-box", transformOrigin: "12px 6.2px" } as const;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <g
        style={pivot}
        className={cn(
          "opacity-55",
          live &&
            "motion-safe:group-hover/lh:animate-lighthouse-beam motion-safe:group-focus-visible/lh:animate-lighthouse-beam",
        )}
      >
        <path d="M9.7 5.3v1.9L2.2 8.9V3.6z" />
        <path d="M14.3 5.3v1.9l7.5 1.7V3.6z" />
      </g>
      <path d="M11.75 2h.5v.9h-.5z" />
      <path d="M10.3 4.5a1.7 1.7 0 0 1 3.4 0z" />
      <path fillRule="evenodd" d="M10.2 4.5h3.6v3.3h-3.6zm.7.7v1.9h2.2V5.2z" />
      <path d="M9.5 7.8h5v.9h-5z" />
      <path fillRule="evenodd" d="M10.3 8.7h3.4l1.1 8.9H9.2zm2.2.8.5 7.3h.6l-.6-7.3z" />
      <path d="M8.4 17.6h7.2v1H8.4zM7.6 18.6h8.8v.9H7.6z" />
      <path d="M6.6 19.5h10.8l3.4 2.2h-6.3l-.9.8H3.6z" />
      {live ? (
        <circle
          cx="12"
          cy="6.2"
          r="1.1"
          style={pivot}
          className="opacity-0 motion-safe:group-hover/lh:animate-lighthouse-lamp motion-safe:group-focus-visible/lh:animate-lighthouse-lamp"
        />
      ) : null}
    </svg>
  );
}

// The beam reaching the "camera". Drawn outside the island so the island's clipping does not cut it
// to the segment; anchored on the lamp, which sits a fixed distance left of the island's centre.
const FLARE_RUN = "motion-safe:group-has-[[data-lh]:hover]/island:opacity-100";
function LighthouseFlare() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-1/2 left-1/2 -mt-1 -ms-26 size-0 opacity-0",
        FLARE_RUN,
        "motion-safe:group-has-[[data-lh]:focus-visible]/island:opacity-100",
      )}
    >
      <span className="absolute size-24 -translate-1/2 rounded-full bg-radial from-zinc-25 from-0% via-muted-foreground/35 via-30% to-transparent to-65% opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-bloom motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-bloom" />
      <span className="absolute h-0.5 w-28 -translate-1/2 rounded-full bg-linear-to-r from-transparent via-zinc-25 to-transparent opacity-0 drop-shadow-sm motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-streak motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-streak" />
      <span className="absolute left-26 size-5 -translate-1/2 rounded-full border border-muted-foreground/40 bg-zinc-25/20 opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-ghost motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-ghost" />
      <span className="absolute left-36 size-2.5 -translate-1/2 rounded-full bg-muted-foreground/30 opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-ghost motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-ghost" />
      <span className="absolute left-46 size-6 -translate-1/2 rounded-full bg-radial from-transparent from-50% via-muted-foreground/30 via-65% to-transparent to-75% opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-ghost motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-ghost" />
    </span>
  );
}

function CodeGlyph({ live, ...props }: SVGProps<SVGSVGElement> & { live?: boolean }) {
  const pivot = { transformBox: "view-box", transformOrigin: "12px 12px" } as const;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path
        d="m8 7-5 5 5 5"
        className={cn(
          live &&
            "motion-safe:group-hover/code:animate-code-left motion-safe:group-focus-visible/code:animate-code-left",
        )}
      />
      <path
        d="m16 7 5 5-5 5"
        className={cn(
          live &&
            "motion-safe:group-hover/code:animate-code-right motion-safe:group-focus-visible/code:animate-code-right",
        )}
      />
      <path
        d="m13.5 4.5-3 15"
        style={pivot}
        className={cn(
          live &&
            "motion-safe:group-hover/code:animate-code-slash motion-safe:group-focus-visible/code:animate-code-slash",
        )}
      />
    </svg>
  );
}

export function LighthouseIsland() {
  const navigate = useNavigate();
  const onWork = useLighthouseSearch() !== null;
  const Current = onWork ? LighthouseGlyph : CodeGlyph;
  const modes = [
    {
      id: "work",
      label: "Lighthouse",
      active: onWork,
      go: () =>
        void navigate({
          to: "/prototype/lighthouse",
          search: { variant: "A", as: "admin", chat: "mine", view: "chats" },
        }),
    },
    {
      id: "code",
      label: "Code",
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
        aria-label="Lighthouse or Code"
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
              data-lh={m.id === "work" ? "" : undefined}
              aria-pressed={m.active}
              onClick={m.active ? undefined : m.go}
              className={cn(
                "relative z-10 flex items-center justify-center gap-2 rounded-xl text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                m.id === "work" ? "group/lh" : "group/code",
                m.active
                  ? "cursor-default text-background"
                  : "cursor-pointer text-muted-foreground hover:text-foreground",
              )}
            >
              {m.id === "work" ? (
                <LighthouseGlyph className="relative size-4.5" live />
              ) : (
                <CodeGlyph className="relative size-4.5" live />
              )}
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <LighthouseFlare />
    </div>
  );
}
