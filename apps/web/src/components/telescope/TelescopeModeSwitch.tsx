import { useState } from "react";

import { cn } from "../../lib/utils";
import { useNavigateToAppMode } from "../sidebar/mainAppLocation";
import { MicroscopeGlyph, TelescopeGlyph } from "./ModeGlyphs";
import { useTelescopeView } from "./telescopeViews";

/**
 * Rests as a faint capsule and opens on hover or keyboard focus; CSS only, nothing runs at rest.
 * Phones have no room in the top bar, so there the sidebar sheet switches modes.
 */
export function TelescopeModeSwitch() {
  const navigateToAppMode = useNavigateToAppMode();
  const onTelescope = useTelescopeView() !== null;
  const Current = onTelescope ? TelescopeGlyph : MicroscopeGlyph;
  // The resting icon remounts on every switch and plays only for one made outside the open
  // capsule; after a click here it is hidden, and on first load nothing switched.
  const [resting, setResting] = useState({ onTelescope, play: false });
  const [switchedHere, setSwitchedHere] = useState(false);
  if (resting.onTelescope !== onTelescope) {
    setResting({ onTelescope, play: !switchedHere });
    setSwitchedHere(false);
  }
  // A run stops when it ends or when the open capsule closes over it; left on, it replays on reshow.
  const settle = () =>
    setResting((current) => (current.play ? { ...current, play: false } : current));
  const modes = [
    {
      id: "telescope",
      label: "Telescope",
      icon: TelescopeGlyph,
      active: onTelescope,
      go: () => void navigateToAppMode("telescope"),
    },
    {
      id: "microscope",
      label: "Microscope",
      icon: MicroscopeGlyph,
      active: !onTelescope,
      go: () => void navigateToAppMode("code"),
    },
  ];
  return (
    <div
      data-header-island=""
      className={cn(
        "pointer-events-none fixed top-(--workspace-controls-top) left-1/2 z-50 hidden h-(--workspace-topbar-height) -translate-x-1/2 items-center [-webkit-app-region:no-drag] md:flex",
        "transition-[scale,opacity] duration-500 ease-spring motion-reduce:transition-none",
        "data-covered:scale-x-40 data-covered:scale-y-0 data-covered:opacity-0 data-covered:duration-250 data-covered:ease-anticipate",
      )}
    >
      <div
        role="group"
        aria-label="Telescope or Microscope"
        className={cn(
          "group/mode pointer-events-auto relative flex h-6 w-14 items-center justify-center overflow-hidden rounded-full border border-transparent bg-foreground/85 opacity-45 shadow-sm",
          "transition-[width,height,border-radius,background-color,opacity] duration-200 ease-out motion-reduce:transition-none",
          "hover:h-10 hover:w-72 hover:rounded-xl hover:border-border hover:bg-popover hover:opacity-100",
          "has-[:focus-visible]:h-10 has-[:focus-visible]:w-72 has-[:focus-visible]:rounded-xl has-[:focus-visible]:border-border has-[:focus-visible]:bg-popover has-[:focus-visible]:opacity-100",
        )}
        onPointerLeave={settle}
        onBlur={settle}
      >
        <Current
          data-glyph-play={resting.play ? "" : undefined}
          onAnimationEnd={(event) => {
            const parts = event.currentTarget.getAnimations({ subtree: true });
            if (parts.every((part) => part.playState !== "running")) settle();
          }}
          className="absolute size-3.5 text-background group-hover/mode:opacity-0 group-has-[:focus-visible]/mode:opacity-0"
        />
        <div className="pointer-events-none grid h-8 w-70 shrink-0 grid-cols-2 gap-1 opacity-0 group-hover/mode:pointer-events-auto group-hover/mode:opacity-100 group-has-[:focus-visible]/mode:pointer-events-auto group-has-[:focus-visible]/mode:opacity-100">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-glyph-trigger=""
              data-flare-trigger={mode.id === "telescope" ? "" : undefined}
              aria-pressed={mode.active}
              onClick={
                mode.active
                  ? undefined
                  : () => {
                      setSwitchedHere(true);
                      mode.go();
                    }
              }
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                mode.active
                  ? "cursor-default bg-foreground text-background"
                  : "cursor-pointer text-muted-foreground hover:text-foreground",
              )}
            >
              <mode.icon key={String(mode.active)} className="size-4" />
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <TelescopeFlare />
    </div>
  );
}

// Beside the capsule because the capsule clips what it holds; anchored where the Telescope
// segment's lens peaks in its sweep.
function TelescopeFlare() {
  return (
    <span
      aria-hidden="true"
      data-flare=""
      className="pointer-events-none absolute top-1/2 left-1/2 -mt-2 -ms-26 size-0"
    >
      <span className="absolute size-24 -translate-1/2 rounded-full bg-radial from-zinc-25 from-0% via-muted-foreground/35 via-30% to-transparent to-65% opacity-0 telescope-flare-run:animate-telescope-bloom" />
      <span className="absolute h-0.5 w-28 -translate-1/2 rounded-full bg-linear-to-r from-transparent via-zinc-25 to-transparent opacity-0 drop-shadow-sm telescope-flare-run:animate-telescope-streak" />
      <span className="absolute left-26 size-5 -translate-1/2 rounded-full border border-muted-foreground/40 bg-zinc-25/20 opacity-0 telescope-flare-run:animate-telescope-ghost" />
      <span className="absolute left-36 size-2.5 -translate-1/2 rounded-full bg-muted-foreground/30 opacity-0 telescope-flare-run:animate-telescope-ghost" />
      <span className="absolute left-46 size-6 -translate-1/2 rounded-full bg-radial from-transparent from-50% via-muted-foreground/30 via-65% to-transparent to-75% opacity-0 telescope-flare-run:animate-telescope-ghost" />
    </span>
  );
}
