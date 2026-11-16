import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { telescopeFilesTarget } from "./telescopeFiles";

const here = EnvironmentId.make("here");
const there = EnvironmentId.make("there");
const mount = (environmentId: EnvironmentId, id: string) => ({
  environmentId,
  projectId: ProjectId.make(id),
});
const codi = (environmentId: EnvironmentId, id: string) => ({
  environmentId,
  id: ProjectId.make(id),
  title: id,
});
const loaded = [codi(here, "app"), codi(here, "docs"), codi(there, "app")];

describe("telescopeFilesTarget", () => {
  it("opens the first mount on this machine, skipping other machines' and unloaded ones", () => {
    const target = telescopeFilesTarget(
      {
        mounts: [mount(there, "app"), mount(here, "gone"), mount(here, "docs"), mount(here, "app")],
      },
      here,
      loaded,
    );
    expect(target).toEqual({ ready: true, projectId: "docs", remote: ["app"] });
  });

  it("is unavailable, with a distinct reason, without a project, without mounts, or with only other machines' mounts", () => {
    const targets = [
      telescopeFilesTarget(undefined, here, loaded),
      telescopeFilesTarget({ mounts: [] }, here, loaded),
      telescopeFilesTarget({ mounts: [mount(there, "app")] }, here, loaded),
    ];
    expect(targets.map((target) => target.ready)).toEqual([false, false, false]);
    expect(new Set(targets.map((target) => !target.ready && target.reason)).size).toBe(3);
    expect(targets[2]).toMatchObject({ reason: expect.stringContaining("app") });
  });
});
