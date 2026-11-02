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

// The beam reaching the "camera": a bloom on the lamp and an anamorphic streak across the
// segment, timed to the moment the beam faces the viewer.
function LighthouseFlare() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
    >
      <span
        className={cn(
          "absolute top-[38%] left-[22%] size-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-radial from-current from-0% via-current/25 via-30% to-transparent to-70% opacity-0",
          "motion-safe:group-hover/lh:animate-lighthouse-bloom motion-safe:group-focus-visible/lh:animate-lighthouse-bloom",
        )}
      />
      <span
        className={cn(
          "absolute inset-x-0 top-[38%] h-0.5 -translate-y-1/2 rounded-full bg-linear-to-r from-transparent via-current to-transparent opacity-0",
          "motion-safe:group-hover/lh:animate-lighthouse-streak motion-safe:group-focus-visible/lh:animate-lighthouse-streak",
        )}
      />
    </span>
  );
}

function CodeGlyph({ live, ...props }: SVGProps<SVGSVGElement> & { live?: boolean }) {
  const dot = (x: number, hot: string, delay: string) => (
    <circle
      cx={x}
      cy="7"
      r="0.85"
      stroke="none"
      fill="currentColor"
      style={{ animationDelay: delay }}
      className={cn(
        "opacity-60",
        live && hot,
        live &&
          "motion-safe:group-hover/code:animate-code-dot motion-safe:group-focus-visible/code:animate-code-dot",
      )}
    />
  );
  const pivot = { transformBox: "view-box", transformOrigin: "12px 14px" } as const;
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
      <rect x="2.5" y="3.5" width="19" height="17" rx="3" />
      <path d="M2.5 9.5h19" strokeWidth={1.25} />
      {dot(6, "group-hover/code:fill-destructive group-focus-visible/code:fill-destructive", "0ms")}
      {dot(8.6, "group-hover/code:fill-warning group-focus-visible/code:fill-warning", "150ms")}
      {dot(11.2, "group-hover/code:fill-success group-focus-visible/code:fill-success", "300ms")}
      <path
        d="m9 11.5-2.5 2.5L9 16.5"
        className={cn(
          live &&
            "motion-safe:group-hover/code:animate-code-left motion-safe:group-focus-visible/code:animate-code-left",
        )}
      />
      <path
        d="m15 11.5 2.5 2.5-2.5 2.5"
        className={cn(
          live &&
            "motion-safe:group-hover/code:animate-code-right motion-safe:group-focus-visible/code:animate-code-right",
        )}
      />
      <path
        d="m13 11-2 6"
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
              {m.id === "work" ? <LighthouseFlare /> : null}
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
    </div>
  );
}
