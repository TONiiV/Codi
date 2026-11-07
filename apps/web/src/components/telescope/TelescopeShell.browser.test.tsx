import "~/index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Sidebar, SidebarProvider, SidebarTrigger } from "../ui/sidebar";
import { TelescopeSidebar } from "./TelescopeShell";

vi.mock("./TelescopeChatList", () => ({ TelescopeChatList: () => null }));
vi.mock("./TelescopeAccount", () => ({ TelescopeAccountFooter: () => null }));
vi.mock("./TelescopeChatPage", () => ({ TelescopeChatPage: () => null }));
vi.mock("./MyTeamsPage", () => ({ MyTeamsPage: () => null }));
vi.mock("./TelescopeDashboard", () => ({ TelescopeDashboard: () => null }));
vi.mock("./TaskDrawer", () => ({ TaskDrawer: () => null }));

describe("TelescopeSidebar", () => {
  it("keeps the phone sheet's toggle clickable under a top safe-area inset", async () => {
    await page.viewport(400, 800);
    const session = cdp();
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47 } });
    try {
      await using screen = await render(
        <SidebarProvider>
          <Sidebar collapsible="icon">
            <TelescopeSidebar view="chats" />
          </Sidebar>
          <SidebarTrigger />
        </SidebarProvider>,
      );
      await userEvent.click(
        screen.container.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]')!,
      );

      await vi.waitFor(() => {
        const toggle = document.querySelector<HTMLElement>(
          '[data-mobile="true"] [data-slot="sidebar-trigger"]',
        )!;
        const box = toggle.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        expect(toggle.contains(hit)).toBe(true);
      });
    } finally {
      await session.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    }
  });
});
