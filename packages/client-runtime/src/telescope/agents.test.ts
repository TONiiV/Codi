import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { cappedPowers, ownerCanMergePRs } from "./agents.ts";

const workspaceId = Telescope.WorkspaceId.make("ws");
const app = ProjectId.make("app");
const member = (role: Telescope.WorkspaceRole): Telescope.Member => ({
  workspaceId,
  subjectId: "me",
  displayName: "Me",
  role,
  joinedAt: "2026-11-06T00:00:00.000Z",
});
const binding = (leadSubjectId?: string): Telescope.ProjectBinding => ({
  workspaceId,
  environmentId: EnvironmentId.make("local"),
  projectId: app,
  ...(leadSubjectId === undefined ? {} : { leadSubjectId }),
});
const ALL_POWERS: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};

describe("telescope standing power cap", () => {
  it.each([
    ["admin", undefined, [], true],
    ["project_lead", app, [binding("me")], true],
    ["project_lead", app, [binding("someone-else")], false],
    ["project_lead", undefined, [binding("me")], false],
    ["member", app, [binding()], false],
  ] as const)("a %s owner of project %s may merge: %s", (role, projectId, bindings, expected) => {
    const agent = projectId === undefined ? {} : { projectId };
    expect(ownerCanMergePRs(member(role), agent, bindings)).toBe(expected);
  });

  it("keeps a stored merge right off above the cap and leaves other powers alone", () => {
    expect(cappedPowers(ALL_POWERS, false)).toEqual({ ...ALL_POWERS, mergePRs: false });
    expect(cappedPowers(ALL_POWERS, true)).toEqual(ALL_POWERS);
  });
});
