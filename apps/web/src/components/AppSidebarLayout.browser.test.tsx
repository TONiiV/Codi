import "~/index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+b", command: "sidebar.toggle", when: "!terminalFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});
// The thread list needs live environments; the shortcut lives in the shell around it.
vi.mock("./Sidebar", () => ({ default: () => null }));
vi.mock("./BackgroundThreadAnnouncer", () => ({ BackgroundThreadAnnouncer: () => null }));
vi.mock("./telescope/TelescopeModeSwitch", () => ({ TelescopeModeSwitch: () => null }));
vi.mock("./telescope/TasksSidebar", () => ({ TasksSidebar: () => null }));
vi.mock("./telescope/TelescopeAccount", () => ({ TelescopeAccountFooter: () => null }));
vi.mock("./telescope/TelescopeChatList", () => ({ TelescopeChatList: () => null }));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarBrandWidthProbe: () => null,
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

import { AppSidebarLayout } from "./AppSidebarLayout";

describe("AppSidebarLayout in Telescope", () => {
  it("leaves no view rail on screen when the sidebar is hidden", async () => {
    await page.viewport(1440, 900);
    localStorage.removeItem("chat_thread_sidebar_open");
    await using screen = await render(<AppSidebarLayout>{null}</AppSidebarLayout>, {
      router: "/telescope?view=tasks",
    });
    const rail = () => document.querySelector<HTMLElement>('nav[aria-label="Telescope"]');
    const onScreen = () => rail()!.getBoundingClientRect().right > 0;
    await vi.waitFor(() => expect(rail()).not.toBeNull());
    expect(onScreen()).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Toggle main sidebar" }));

    await vi.waitFor(() => expect(onScreen()).toBe(false));
  });
});

describe("sidebar toggle shortcut", () => {
  it("leaves the key to a focused terminal when its rule excludes terminalFocus", async () => {
    await page.viewport(1280, 800);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(
      <AppSidebarLayout>
        <div data-terminal-owner="drawer">
          <textarea aria-label="Terminal input" />
        </div>
        <button type="button">Outside</button>
      </AppSidebarLayout>,
    );
    const wrapper = screen.container.querySelector('[data-slot="sidebar-wrapper"]')!;

    await userEvent.click(screen.getByRole("textbox", { name: "Terminal input" }));
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(wrapper.getAttribute("data-sidebar-state")).toBe("expanded");

    await userEvent.click(screen.getByRole("button", { name: "Outside" }));
    await userEvent.keyboard("{Control>}b{/Control}");
    await vi.waitFor(() => expect(wrapper.getAttribute("data-sidebar-state")).toBe("collapsed"));
  });
});
