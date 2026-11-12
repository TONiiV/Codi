import type { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";

export type TelescopeFilesTarget =
  | {
      readonly ready: true;
      readonly projectId: ProjectId;
      readonly title: string;
      readonly workspaceRoot: string;
    }
  | {
      readonly ready: false;
      readonly reason: string;
      /** Mounts on other machines, which the panel lists but cannot open. */
      readonly remote: ReadonlyArray<Telescope.ProjectMount>;
    };

const unavailable = (reason: string, remote: ReadonlyArray<Telescope.ProjectMount> = []) =>
  ({ ready: false, reason, remote }) as const;

/** Code's Files pointed at the project's first mount on `environmentId`, the machine Telescope runs on. */
export function telescopeFilesTarget(
  project: Pick<Telescope.Project, "mounts"> | undefined,
  environmentId: EnvironmentId,
  codiProjects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  }>,
): TelescopeFilesTarget {
  if (project === undefined) return unavailable("先在左侧选一个项目，或打开一个任务。");
  if (project.mounts.length === 0) return unavailable("这个项目还没有挂目录。");
  const local = project.mounts.filter((mount) => mount.environmentId === environmentId);
  if (local.length === 0) {
    return unavailable("这个项目的目录在另一台机器上，这里打不开。", project.mounts);
  }
  for (const mount of local) {
    const found = codiProjects.find(
      (entry) => entry.environmentId === mount.environmentId && entry.id === mount.projectId,
    );
    if (found !== undefined) {
      return {
        ready: true,
        projectId: found.id,
        title: found.title,
        workspaceRoot: found.workspaceRoot,
      };
    }
  }
  return unavailable("这个项目挂的目录在这台机器上找不到。");
}
