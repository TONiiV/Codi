import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { Route as TelescopeRoute } from "../../routes/_chat.telescope";
import { telescopeSearchAt } from "./telescopeViews";

function matchedSearch(url: string) {
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
  return router.matchRoutes(router.latestLocation).at(-1)?.search;
}

describe("telescope view", () => {
  it("deep links to a known view and layout and falls back otherwise", () => {
    expect(matchedSearch("/telescope?view=tasks")).toEqual({ view: "tasks" });
    expect(matchedSearch("/telescope?view=tasks&layout=board")).toEqual({
      view: "tasks",
      layout: "board",
    });
    expect(telescopeSearchAt("/telescope", { view: "tasks", layout: "grid" }, null)).toEqual({
      view: "tasks",
    });
    expect(matchedSearch("/telescope?view=tasks&layout=board&task=t-1")).toEqual({
      view: "tasks",
      layout: "board",
      task: "t-1",
    });
    expect(matchedSearch("/telescope?view=dashboard&task=t-1")).toEqual({
      view: "dashboard",
      task: "t-1",
    });
    expect(telescopeSearchAt("/telescope", { view: "tasks", task: " " }, null)).toEqual({
      view: "tasks",
    });
    expect(telescopeSearchAt("/telescope", { view: "tasks", task: ["t-1"] }, null)).toEqual({
      view: "tasks",
    });
    expect(matchedSearch("/telescope?view=lighthouse")).toEqual({ view: "chats" });
    expect(matchedSearch("/telescope?view=123")).toEqual({ view: "chats" });
    expect(matchedSearch("/telescope")).toEqual({ view: "chats" });
  });

  it("stays on behind a Settings or Usage modal opened from Telescope", () => {
    expect({
      settings: telescopeSearchAt("/settings/general", {}, "/telescope?view=tasks"),
      board: telescopeSearchAt("/settings", {}, "/telescope?view=tasks&layout=board"),
      usage: telescopeSearchAt("/usage", {}, "/telescope"),
      fromCode: telescopeSearchAt("/settings", {}, "/env/thread"),
      noOpener: telescopeSearchAt("/usage", {}, null),
      utilityPage: telescopeSearchAt("/pull-requests", {}, "/telescope?view=tasks"),
    }).toEqual({
      settings: { view: "tasks" },
      board: { view: "tasks", layout: "board" },
      usage: { view: "chats" },
      fromCode: null,
      noOpener: null,
      utilityPage: null,
    });
  });
});
