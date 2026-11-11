import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadOutsideProject } from "./threadTaskProject";

const local = EnvironmentId.make("local");
const projectId = Telescope.TelescopeProjectId.make("p-1");
const projects: ReadonlyArray<Telescope.Project> = [
  {
    id: projectId,
    workspaceId: Telescope.WorkspaceId.make("ws"),
    name: "App",
    mounts: [{ environmentId: local, projectId: ProjectId.make("app") }],
    createdAt: "2026-11-08T00:00:00.000Z",
  },
];
const thread = (environmentId: EnvironmentId, code: string) => ({
  environmentId,
  projectId: ProjectId.make(code),
});

describe("thread task project hint", () => {
  it("hints only when the task has a project and none of its mounts holds the thread's", () => {
    const task = { projectId };
    expect([
      threadOutsideProject(task, projects, thread(local, "app")),
      threadOutsideProject(task, projects, thread(local, "docs")),
      threadOutsideProject(task, projects, thread(EnvironmentId.make("remote"), "app")),
      threadOutsideProject({}, projects, thread(local, "docs")),
      threadOutsideProject(
        { projectId: Telescope.TelescopeProjectId.make("gone") },
        projects,
        thread(local, "docs"),
      ),
    ]).toEqual([false, true, true, false, false]);
  });
});
