import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { cappedPowers, ownerCanMergePRs } from "./agents.ts";

const workspaceId = Telescope.WorkspaceId.make("ws");
const app = ProjectId.make("app");
const docs = ProjectId.make("docs");
const member = (role: Telescope.WorkspaceRole): Telescope.Member => ({
  workspaceId,
  subjectId: "me",
  displayName: "Me",
  role,
  joinedAt: "2026-11-06T00:00:00.000Z",
});
const binding = (leadSubjectId?: string, projectId = app): Telescope.ProjectBinding => ({
  workspaceId,
  environmentId: EnvironmentId.make("local"),
  projectId,
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
    { who: "an admin", role: "admin", projectId: undefined, bindings: [], expected: true },
    {
      who: "the agent project lead",
      role: "project_lead",
      projectId: app,
      bindings: [binding("me")],
      expected: true,
    },
    {
      who: "a lead whose project has another lead",
      role: "project_lead",
      projectId: app,
      bindings: [binding("someone-else")],
      expected: false,
    },
    {
      who: "the lead of another project",
      role: "project_lead",
      projectId: app,
      bindings: [binding("someone-else"), binding("me", docs)],
      expected: false,
    },
    {
      who: "a lead with an unbound agent",
      role: "project_lead",
      projectId: undefined,
      bindings: [binding("me")],
      expected: false,
    },
    { who: "a member", role: "member", projectId: app, bindings: [binding()], expected: false },
  ] as const)("$who may merge: $expected", ({ role, projectId, bindings, expected }) => {
    const agent = projectId === undefined ? {} : { projectId };
    expect(ownerCanMergePRs(member(role), agent, bindings)).toBe(expected);
  });

  it("keeps a stored merge right off above the cap and leaves other powers alone", () => {
    expect(cappedPowers(ALL_POWERS, false)).toEqual({ ...ALL_POWERS, mergePRs: false });
    expect(cappedPowers(ALL_POWERS, true)).toEqual(ALL_POWERS);
  });
});
