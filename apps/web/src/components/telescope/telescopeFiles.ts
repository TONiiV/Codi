import type { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";

export type TelescopeFilesTarget =
  | {
      readonly ready: true;
      readonly projectId: ProjectId;
      /** Titles of the mounts on other machines, which the panel lists but cannot open. */
      readonly remote: ReadonlyArray<string>;
    }
  | { readonly ready: false; readonly reason: string };

/** Code's Files pointed at the project's first mount on `environmentId`, the machine Telescope runs on. */
export function telescopeFilesTarget(
  project: Pick<Telescope.Project, "mounts"> | undefined,
  environmentId: EnvironmentId,
  codiProjects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly title: string;
  }>,
): TelescopeFilesTarget {
  if (project === undefined) {
    return { ready: false, reason: "先在左侧选一个项目，或打开一个任务。" };
  }
  if (project.mounts.length === 0) {
    return { ready: false, reason: "这个项目还没有挂目录。" };
  }
  const codiProject = (mount: Telescope.ProjectMount) =>
    codiProjects.find(
      (entry) => entry.environmentId === mount.environmentId && entry.id === mount.projectId,
    );
  const remote = project.mounts
    .filter((mount) => mount.environmentId !== environmentId)
    .map((mount) => codiProject(mount)?.title ?? mount.projectId);
  const local = project.mounts.filter((mount) => mount.environmentId === environmentId);
  if (local.length === 0) {
    return {
      ready: false,
      reason: `这个项目的目录在另一台机器上，这里打不开：${remote.join("、")}。`,
    };
  }
  for (const mount of local) {
    const found = codiProject(mount);
    if (found !== undefined) return { ready: true, projectId: found.id, remote };
  }
  return { ready: false, reason: "这个项目挂的目录在这台机器上找不到。" };
}
