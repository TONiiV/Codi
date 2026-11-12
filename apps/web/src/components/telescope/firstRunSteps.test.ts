import { describe, expect, it } from "vite-plus/test";

import { firstRunStep } from "./firstRunSteps";

const open = {
  hasWorkspace: true,
  projectCount: 0,
  mayConnect: true,
  mayInvite: true,
  inviteClosed: false,
};

describe("firstRunStep", () => {
  it.each([
    ["no workspace", { ...open, hasWorkspace: false }, "create"],
    ["a workspace with no project", open, "mount"],
    ["a workspace with a project", { ...open, projectCount: 1 }, "invite"],
    ["the invite step skipped", { ...open, projectCount: 1, inviteClosed: true }, "done"],
    ["a caller who may not invite", { ...open, projectCount: 1, mayInvite: false }, "done"],
    ["a caller who may not connect, no project", { ...open, mayConnect: false }, "invite"],
    ["a caller who may do neither", { ...open, mayConnect: false, mayInvite: false }, "done"],
  ] as const)("%s", (_name, state, expected) => {
    expect(firstRunStep(state)).toBe(expected);
  });
});
