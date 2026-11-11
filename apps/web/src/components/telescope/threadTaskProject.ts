import type { Telescope } from "@t3tools/contracts";

/** Whether a thread's Code project is no mount of its task's project. No project, no hint. */
export function threadOutsideProject(
  task: Pick<Telescope.Task, "projectId">,
  projects: ReadonlyArray<Telescope.Project>,
  thread: Telescope.ProjectMount,
) {
  const project = projects.find((candidate) => candidate.id === task.projectId);
  return (
    project !== undefined &&
    !project.mounts.some(
      (mount) =>
        mount.environmentId === thread.environmentId && mount.projectId === thread.projectId,
    )
  );
}
