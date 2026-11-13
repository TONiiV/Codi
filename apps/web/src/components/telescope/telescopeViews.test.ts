import { Telescope } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { Route as TelescopeRoute } from "../../routes/_chat.telescope";
import {
  knownProjectId,
  parseTelescopeSearch,
  telescopeSearch,
  telescopeSearchAt,
} from "./telescopeViews";

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
    expect(matchedSearch("/telescope?view=projects")).toEqual({ view: "projects" });
    expect(matchedSearch("/telescope?view=tasks&layout=board")).toEqual({
      view: "tasks",
      layout: "board",
    });
    expect(telescopeSearchAt("/telescope", { view: "tasks", layout: "grid" }, null)).toEqual({
      view: "tasks",
    });
    expect(matchedSearch("/telescope?view=decisions")).toEqual({
      view: "tasks",
      layout: "decisions",
    });
    expect(matchedSearch("/telescope?view=tasks&layout=decisions")).toEqual({
      view: "tasks",
      layout: "decisions",
    });
    expect(parseTelescopeSearch(telescopeSearch("tasks", "decisions"))).toEqual({
      view: "tasks",
      layout: "decisions",
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
    expect(telescopeSearchAt("/telescope", { view: "chats", agent: "a-1" }, null)).toEqual({
      view: "tasks",
      agent: "a-1",
    });
    expect(telescopeSearchAt("/telescope", { view: "chats", agent: " " }, null)).toEqual({
      view: "tasks",
    });
    expect(telescopeSearchAt("/telescope", { view: "chats", agent: ["a-1"] }, null)).toEqual({
      view: "tasks",
    });
    expect(
      telescopeSearchAt("/telescope", { view: "tasks", layout: "board", project: "p-1" }, null),
    ).toEqual({ view: "tasks", layout: "board", project: "p-1" });
    expect(telescopeSearchAt("/telescope", { view: "tasks", layout: "board" }, null)).toEqual({
      view: "tasks",
      layout: "board",
    });
    expect(telescopeSearchAt("/telescope", { view: "tasks", project: " " }, null)).toEqual({
      view: "tasks",
    });
    expect(telescopeSearchAt("/telescope", { view: "tasks", project: ["p-1"] }, null)).toEqual({
      view: "tasks",
    });
    expect(matchedSearch("/telescope?view=teams")).toEqual({ view: "tasks" });
    expect(matchedSearch("/telescope?view=lighthouse")).toEqual({ view: "tasks" });
    expect(matchedSearch("/telescope?view=123")).toEqual({ view: "tasks" });
    expect(matchedSearch("/telescope")).toEqual({ view: "tasks" });
  });

  it("shows 全部 for a project the workspace no longer has", () => {
    const id = Telescope.TelescopeProjectId.make;
    const projects = [{ id: id("p-1") }, { id: id("p-2") }];
    expect({
      listed: knownProjectId(id("p-2"), projects),
      removed: knownProjectId(id("gone"), projects),
      none: knownProjectId(undefined, projects),
      loading: knownProjectId(id("p-2"), null),
    }).toEqual({ listed: "p-2", removed: undefined, none: undefined, loading: "p-2" });
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
      usage: { view: "tasks" },
      fromCode: null,
      noOpener: null,
      utilityPage: null,
    });
  });
});
