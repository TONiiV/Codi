// PROTOTYPE, wipe me. Floating Lighthouse / Code switch at the top centre of the app. It rests as a
// faint capsule and morphs into a two-icon switch when the pointer comes near. Pure CSS hover, so
// nothing animates while the pointer is elsewhere.
import { useNavigate } from "@tanstack/react-router";
import type { SVGProps } from "react";

import { cn } from "../../lib/utils";
import { useLighthouseSearch } from "./lighthouseLocation";

// Hover animations are scoped to each segment's own group, so they run only while that segment is
// under the pointer (or keyboard focus) and stop the moment it leaves.
const LH_HOT = "group-hover/lh:opacity-100 group-focus-visible/lh:opacity-100";

function LighthouseGlyph({ live, ...props }: SVGProps<SVGSVGElement> & { live?: boolean }) {
  const pivot = { transformBox: "view-box", transformOrigin: "12px 8px" } as const;
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
      <path d="M9.5 9.5h5L16 21H8z" />
      <path d="M10 9.5V6.5h4v3" />
      <path d="M9 6.5 12 3.5l3 3" />
      <path d="M8.8 15.2h6.4" />
      <path d="M4 21h16" />
      <g
        className={cn(
          "transition-opacity duration-200",
          live && "group-hover/lh:opacity-0 group-focus-visible/lh:opacity-0",
        )}
      >
        <path d="M2.5 5.5 7.5 7" />
        <path d="M21.5 5.5 16.5 7" />
      </g>
      {live ? (
        <>
          <path
            d="M12 8 1.5 4.5v7z"
            fill="currentColor"
            stroke="none"
            style={pivot}
            className={cn(
              "opacity-0",
              LH_HOT,
              "motion-safe:group-hover/lh:animate-lighthouse-beam motion-safe:group-focus-visible/lh:animate-lighthouse-beam",
            )}
          />
          <circle
            cx="12"
            cy="8"
            r="1"
            fill="currentColor"
            stroke="none"
            style={pivot}
            className={cn(
              "opacity-0",
              LH_HOT,
              "motion-safe:group-hover/lh:animate-lighthouse-lamp motion-safe:group-focus-visible/lh:animate-lighthouse-lamp",
            )}
          />
        </>
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
      <span className="absolute size-24 -translate-1/2 rounded-full bg-radial from-warning/90 from-0% via-warning/30 via-25% to-transparent to-65% opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-bloom motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-bloom" />
      <span className="absolute h-0.5 w-28 -translate-1/2 rounded-full bg-linear-to-r from-transparent via-warning/80 to-transparent opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-streak motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-streak" />
      <span className="absolute left-26 size-5 -translate-1/2 rounded-full border border-warning/50 bg-warning/10 opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-ghost motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-ghost" />
      <span className="absolute left-36 size-2.5 -translate-1/2 rounded-full bg-warning/40 opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-ghost motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-ghost" />
      <span className="absolute left-46 size-6 -translate-1/2 rounded-full bg-radial from-transparent from-50% via-warning/25 via-65% to-transparent to-75% opacity-0 motion-safe:group-has-[[data-lh]:hover]/island:animate-lighthouse-ghost motion-safe:group-has-[[data-lh]:focus-visible]/island:animate-lighthouse-ghost" />
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
