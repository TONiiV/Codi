import "~/index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { AppSidebarLayout } from "./AppSidebarLayout";

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
