import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createTelescopeWorkspaceAtoms,
  boundWorkspaceIds,
  failureText,
  hiddenOutsideWorkspace,
  resolveCurrentWorkspace,
  WORKSPACE_ERROR_TEXT,
  workspacesToLeave,
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

  it("a move leaves only the caller's own workspaces", () => {
    const foreign = Telescope.WorkspaceId.make("foreign");
    const both = new Set([a, b, foreign]);
    const own = [workspace("a"), workspace("b")];
    expect(workspacesToLeave(both, b, own)).toEqual([a]);
    expect(workspacesToLeave(both, null, own)).toEqual([a, b]);
  });
});

describe("telescope command failure text", () => {
  const refused = (reason: Telescope.WorkspaceError["reason"]) =>
    AsyncResult.failure(
      Cause.fail(new Telescope.WorkspaceError({ reason, message: "server text in English" })),
    );
  const join = { ...WORKSPACE_ERROR_TEXT, not_found: "邀请码无效。" };

  it.each([
    ["success", AsyncResult.success({}), undefined, null],
    ["forbidden", refused("forbidden"), undefined, "你没有权限做这件事。"],
    ["conflict", refused("conflict"), undefined, "和当前状态冲突，请刷新后再试。"],
    ["invalid", refused("invalid"), undefined, "请求内容无效，请检查后重试。"],
    ["not_found with custom copy", refused("not_found"), join, "邀请码无效。"],
    [
      "dropped connection",
      AsyncResult.failure(Cause.interrupt(115)),
      undefined,
      "连接已断开，请检查连接后重试。",
    ],
    [
      "defect",
      AsyncResult.failure(Cause.die(new Error("socket closed"))),
      undefined,
      "请求失败，请检查连接后再试。",
    ],
    [
      "unknown typed error",
      AsyncResult.failure(Cause.fail({ _tag: "Other" })),
      undefined,
      "请求失败，请检查连接后再试。",
    ],
  ] as const)("%s", (_name, result, text, expected) => {
    expect(failureText(result, text)).toBe(expected);
  });
});

describe("telescope switchTo", () => {
  it.effect("refreshes the workspace list and binding summary, then remembers the workspace", () =>
    Effect.gen(function* () {
      const runtime = Atom.runtime(
        Layer.succeed(EnvironmentRegistry, {} as EnvironmentRegistry["Service"]),
      );
      const atoms = createTelescopeWorkspaceAtoms(runtime, { read: () => null, write: () => {} });
      const registry = AtomRegistry.make();
      const refresh = vi.spyOn(registry, "refresh");
      const target = { environmentId: local, input: {} };
      yield* atoms.switchTo(target, registry, Telescope.WorkspaceId.make("b"));
      expect(refresh).toHaveBeenCalledWith(atoms.list(target));
      expect(refresh).toHaveBeenCalledWith(atoms.bindingSummary(target));
      expect(registry.get(atoms.storedWorkspaceIdAtom)).toBe("b");
      registry.dispose();
    }),
  );
});
