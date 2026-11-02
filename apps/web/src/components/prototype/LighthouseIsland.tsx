// PROTOTYPE, wipe me. Floating Lighthouse / Code switch at the top centre of the app. It rests as a
// faint capsule and morphs into a two-icon switch when the pointer comes near. Pure CSS hover, so
// nothing animates while the pointer is elsewhere.
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { SVGProps } from "react";

import { cn } from "../../lib/utils";

function LighthouseGlyph(props: SVGProps<SVGSVGElement>) {
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
      <path d="M2.5 5.5 7.5 7" />
      <path d="M21.5 5.5 16.5 7" />
    </svg>
  );
}

function CodeGlyph(props: SVGProps<SVGSVGElement>) {
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
      <path d="m8 7-5 5 5 5" />
      <path d="m16 7 5 5-5 5" />
      <path d="m13.5 4.5-3 15" />
    </svg>
  );
}

export function LighthouseIsland() {
  const navigate = useNavigate();
  const onWork = useLocation({
    select: (l) => l.pathname.startsWith("/prototype/lighthouse"),
  });
  const Current = onWork ? LighthouseGlyph : CodeGlyph;
  const modes = [
    {
      id: "work",
      label: "Lighthouse",
      Icon: LighthouseGlyph,
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
      Icon: CodeGlyph,
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
          "group-focus-within/island:h-11 group-focus-within/island:w-64 group-focus-within/island:rounded-2xl group-focus-within/island:border-border group-focus-within/island:bg-popover/90 group-focus-within/island:opacity-100 group-focus-within/island:shadow-xl",
        )}
      >
        <Current
          className={cn(
            "absolute size-3.5 text-background transition-[opacity,scale] duration-200 motion-reduce:transition-none",
            "group-hover/island:scale-50 group-hover/island:opacity-0 group-focus-within/island:scale-50 group-focus-within/island:opacity-0",
          )}
        />
        <div
          className={cn(
            "relative grid h-9 w-62 shrink-0 scale-75 grid-cols-2 p-0 opacity-0 transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none",
            "pointer-events-none group-hover/island:pointer-events-auto group-hover/island:scale-100 group-hover/island:opacity-100",
            "group-focus-within/island:pointer-events-auto group-focus-within/island:scale-100 group-focus-within/island:opacity-100",
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
                m.active
                  ? "cursor-default text-background"
                  : "cursor-pointer text-muted-foreground hover:text-foreground",
              )}
            >
              <m.Icon className="size-4.5" />
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
