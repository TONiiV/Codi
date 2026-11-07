import { observeResize } from "../../lib/observeResize";
import { requestWorkspaceContentFocus } from "../../lib/workspaceFocus";

// The chat header's last button rides 12 to 40px left of the panel edge; keep 8px clear of it.
const ISLAND_CLEARANCE_PX = 48;
const ISLAND_HYSTERESIS_PX = 16;

/** A covered island returns only once the edge is a hysteresis band clear, so it never flickers. */
export function isHeaderIslandCovered(
  panel: { readonly left: number; readonly top: number },
  island: { readonly right: number; readonly bottom: number },
  covered: boolean,
) {
  const clearance = ISLAND_CLEARANCE_PX + (covered ? ISLAND_HYSTERESIS_PX : 0);
  return panel.top < island.bottom && panel.left < island.right + clearance;
}

function setIslandCovered(island: HTMLElement, covered: boolean) {
  if (covered && island.contains(document.activeElement)) requestWorkspaceContentFocus();
  island.toggleAttribute("data-covered", covered);
  island.inert = covered;
}

/** Ref-callback body for an inline right panel: hides the header island while the panel reaches it. */
export function hideHeaderIslandUnderPanel(host: HTMLElement): () => void {
  let island: HTMLElement | null = null;
  const update = () => {
    if (!island?.isConnected) island = document.querySelector("[data-header-island]");
    if (!island) return;
    // The island scales about its centre, so its centre and layout size give the resting box.
    const box = island.getBoundingClientRect();
    const resting = {
      right: (box.left + box.right) / 2 + island.offsetWidth / 2,
      bottom: (box.top + box.bottom) / 2 + island.offsetHeight / 2,
    };
    const covered = island.hasAttribute("data-covered");
    const next = isHeaderIslandCovered(host.getBoundingClientRect(), resting, covered);
    if (next !== covered) setIslandCovered(island, next);
  };
  // Resize observers deliver at most once per frame, so a drag reads geometry once per frame.
  const stopObserving = observeResize(host, update);
  window.addEventListener("resize", update);
  return () => {
    stopObserving();
    window.removeEventListener("resize", update);
    if (island?.hasAttribute("data-covered")) setIslandCovered(island, false);
  };
}
