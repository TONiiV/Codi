import { describe, expect, it } from "vite-plus/test";

import { firstRunStep } from "./firstRunSteps";

const open = {
  projectCount: 0,
  mayConnect: true,
  mountPassed: false,
  mayInvite: true,
  inviteClosed: false,
};

describe("firstRunStep", () => {
  it.each([
    ["a workspace with no project", open, "mount"],
    ["the mount step skipped or passed", { ...open, mountPassed: true }, "invite"],
    ["a workspace with a project", { ...open, projectCount: 1 }, "invite"],
    ["the invite step skipped", { ...open, projectCount: 1, inviteClosed: true }, "done"],
    ["a caller who may not invite", { ...open, projectCount: 1, mayInvite: false }, "done"],
    ["a caller who may not connect, no project", { ...open, mayConnect: false }, "invite"],
    ["a caller who may do neither", { ...open, mayConnect: false, mayInvite: false }, "done"],
  ] as const)("%s", (_name, state, expected) => {
    expect(firstRunStep(state)).toBe(expected);
  });
});
