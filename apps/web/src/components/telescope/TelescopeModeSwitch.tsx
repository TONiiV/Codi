import { MicroscopeIcon, TelescopeIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { useNavigateToAppMode } from "../sidebar/mainAppLocation";
import { useTelescopeView } from "./telescopeViews";

/**
 * Rests as a faint capsule and opens on hover or keyboard focus; CSS only, nothing runs at rest.
 * Phones have no room in the top bar, so there the sidebar sheet switches modes.
 */
export function TelescopeModeSwitch() {
  const navigateToAppMode = useNavigateToAppMode();
  const onTelescope = useTelescopeView() !== null;
  const Current = onTelescope ? TelescopeIcon : MicroscopeIcon;
  const modes = [
    {
      id: "telescope",
      label: "Telescope",
      icon: TelescopeIcon,
      active: onTelescope,
      go: () => void navigateToAppMode("telescope"),
    },
    {
      id: "microscope",
      label: "Microscope",
      icon: MicroscopeIcon,
      active: !onTelescope,
      go: () => void navigateToAppMode("code"),
    },
  ];
  return (
    <div className="pointer-events-none fixed top-(--workspace-controls-top) left-1/2 z-50 hidden h-(--workspace-topbar-height) -translate-x-1/2 items-center [-webkit-app-region:no-drag] md:flex">
      <div
        role="group"
        aria-label="Telescope or Microscope"
        className={cn(
          "group/mode pointer-events-auto relative flex h-6 w-14 items-center justify-center overflow-hidden rounded-full border border-transparent bg-foreground/85 opacity-45 shadow-sm",
          "transition-[width,height,border-radius,background-color,opacity] duration-200 ease-out motion-reduce:transition-none",
          "hover:h-10 hover:w-72 hover:rounded-xl hover:border-border hover:bg-popover hover:opacity-100",
          "has-[:focus-visible]:h-10 has-[:focus-visible]:w-72 has-[:focus-visible]:rounded-xl has-[:focus-visible]:border-border has-[:focus-visible]:bg-popover has-[:focus-visible]:opacity-100",
        )}
      >
        <Current
          aria-hidden="true"
          className="absolute size-3.5 text-background group-hover/mode:opacity-0 group-has-[:focus-visible]/mode:opacity-0"
        />
        <div className="pointer-events-none grid h-8 w-70 shrink-0 grid-cols-2 gap-1 opacity-0 group-hover/mode:pointer-events-auto group-hover/mode:opacity-100 group-has-[:focus-visible]/mode:pointer-events-auto group-has-[:focus-visible]/mode:opacity-100">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={mode.active}
              onClick={mode.active ? undefined : mode.go}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                mode.active
                  ? "cursor-default bg-foreground text-background"
                  : "cursor-pointer text-muted-foreground hover:text-foreground",
              )}
            >
              <mode.icon aria-hidden="true" className="size-4" />
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
