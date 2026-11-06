import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boundWorkspaceIds,
  hiddenOutsideWorkspace,
  resolveCurrentWorkspace,
} from "./workspaces.ts";

const workspace = (id: string): Telescope.Workspace => ({
  id: Telescope.WorkspaceId.make(id),
  kind: "enterprise",
  name: id,
  createdAt: "2026-11-06T00:00:00.000Z",
  createdBy: "owner",
});
const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const app = ProjectId.make("app");
const site = ProjectId.make("site");
const bound = (workspaceId: string, environmentId = local, projectId = app) => ({
  workspaceId: Telescope.WorkspaceId.make(workspaceId),
  environmentId,
  projectId,
});

describe("telescope current workspace", () => {
  it("keeps the remembered workspace and falls back to the first one", () => {
    const workspaces = [workspace("a"), workspace("b")];
    expect(resolveCurrentWorkspace(workspaces, Telescope.WorkspaceId.make("b"))?.id).toBe("b");
    expect(resolveCurrentWorkspace(workspaces, Telescope.WorkspaceId.make("gone"))?.id).toBe("a");
    expect(resolveCurrentWorkspace(workspaces, null)?.id).toBe("a");
    expect(resolveCurrentWorkspace([], Telescope.WorkspaceId.make("a"))).toBeNull();
  });
});

describe("telescope project visibility", () => {
  const bindings = [bound("a"), bound("b", remote, site)];
  const a = Telescope.WorkspaceId.make("a");
  const b = Telescope.WorkspaceId.make("b");

  it("collects workspaces from every member of a project group", () => {
    const group = [
      { environmentId: local, projectId: app },
      { environmentId: remote, projectId: site },
    ];
    expect([...boundWorkspaceIds(bindings, group)].toSorted()).toEqual(["a", "b"]);
    expect(boundWorkspaceIds(bindings, [{ environmentId: remote, projectId: app }]).size).toBe(0);
  });

  it("hides only projects bound elsewhere", () => {
    const inA = boundWorkspaceIds(bindings, [{ environmentId: local, projectId: app }]);
    const unbound = boundWorkspaceIds(bindings, [{ environmentId: local, projectId: site }]);
    expect(hiddenOutsideWorkspace(inA, a)).toBe(false);
    expect(hiddenOutsideWorkspace(inA, b)).toBe(true);
    expect(hiddenOutsideWorkspace(inA, null)).toBe(true);
    expect(hiddenOutsideWorkspace(unbound, b)).toBe(false);
    expect(hiddenOutsideWorkspace(unbound, null)).toBe(false);
  });
});
