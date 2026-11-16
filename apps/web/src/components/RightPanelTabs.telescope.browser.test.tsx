import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { TELESCOPE_PANEL_SURFACES } from "../rightPanelStore";
import { RightPanelTabs, type RightPanelTabsProps } from "./RightPanelTabs";

function panel(overrides: Partial<RightPanelTabsProps>) {
  const props: RightPanelTabsProps = {
    mode: "inline",
    open: true,
    keybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
    }),
    surfaces: [],
    environmentId: EnvironmentId.make("env"),
    activeSurfaceId: null,
    pendingSurfaceIds: new Set(),
    previewSessions: {},
    desktopByTabId: {},
    terminalLabelsById: new Map(),
    onActivate: vi.fn(),
    onCloseSurface: vi.fn(),
    onCloseOtherSurfaces: vi.fn(),
    onCloseSurfacesToRight: vi.fn(),
    onCloseAllSurfaces: vi.fn(),
    onCopyFilePath: vi.fn(),
    onAddBrowser: vi.fn(),
    onAddBrowserInProfile: vi.fn(),
    onAddTerminal: vi.fn(),
    onAddDiff: vi.fn(),
    onAddFiles: vi.fn(),
    onAddPullRequest: vi.fn(),
    onAddPullRequests: vi.fn(),
    onAddDevice: vi.fn(),
    onAddSideChat: vi.fn(),
    browserAvailable: true,
    terminalAvailable: true,
    diffAvailable: true,
    filesAvailable: true,
    pullRequestAvailable: true,
    pullRequestsAvailable: true,
    deviceAvailable: true,
    sideChatAvailable: true,
    children: null,
    ...overrides,
  };
  return <RightPanelTabs {...props} />;
}

describe("RightPanelTabs surfaces", () => {
  it("offers every surface in Code's launcher", async () => {
    await using screen = await render(panel({}));
    await expect
      .element(screen.getByLabelText("Open a surface"))
      .toHaveAttribute("data-surface-launcher-keys", "BTFDPLMS");
  });

  it("offers only Browser, Files and Side chat in Telescope, in the launcher and the + menu", async () => {
    const onAddTerminal = vi.fn();
    const onAddSideChat = vi.fn();
    await using screen = await render(
      panel({
        surfaceKinds: TELESCOPE_PANEL_SURFACES,
        onAddTerminal,
        onAddSideChat,
      }),
    );
    const launcher = screen.getByLabelText("Open a surface");
    await expect.element(launcher).toHaveAttribute("data-surface-launcher-keys", "BFS");
    await expect.element(launcher).toHaveTextContent("Open a surfaceBrowserBFilesFSide chatS");
    await userEvent.keyboard("t");
    expect(onAddTerminal).not.toHaveBeenCalled();
    await userEvent.keyboard("s");
    expect(onAddSideChat).toHaveBeenCalledOnce();

    await screen.getByRole("button", { name: "Add panel surface" }).click();
    const items = page.getByRole("menuitem");
    await expect.element(items.first()).toBeVisible();
    expect(items.elements().map((item) => item.textContent)).toEqual([
      "BrowserB",
      "FilesF",
      "Side chatS",
    ]);
  });
});
