import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { Route as TelescopeRoute } from "../../routes/_chat.telescope";
import { telescopeViewAt } from "./telescopeViews";

function matchedView(url: string) {
  const root = createRootRoute();
  const chat = createRoute({ getParentRoute: () => root, id: "_chat" });
  const telescope = createRoute({
    getParentRoute: () => chat,
    path: "telescope",
    validateSearch: TelescopeRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([chat.addChildren([telescope])]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  return router.matchRoutes(router.latestLocation).at(-1)?.search.view;
}

describe("telescope view", () => {
  it("deep links to a known view and falls back to chats otherwise", () => {
    expect(matchedView("/telescope?view=tasks")).toBe("tasks");
    expect(matchedView("/telescope?view=lighthouse")).toBe("chats");
    expect(matchedView("/telescope?view=123")).toBe("chats");
    expect(matchedView("/telescope")).toBe("chats");
  });

  it("stays on behind a Settings or Usage modal opened from Telescope", () => {
    expect({
      settings: telescopeViewAt("/settings/general", undefined, "/telescope?view=tasks"),
      usage: telescopeViewAt("/usage", undefined, "/telescope"),
      fromCode: telescopeViewAt("/settings", undefined, "/env/thread"),
      noOpener: telescopeViewAt("/usage", undefined, null),
      utilityPage: telescopeViewAt("/pull-requests", undefined, "/telescope?view=tasks"),
    }).toEqual({
      settings: "tasks",
      usage: "chats",
      fromCode: null,
      noOpener: null,
      utilityPage: null,
    });
  });
});
