import { Atom } from "effect/reactivity";

export type FirstRunStep = "create" | "mount" | "invite" | "done";

/**
 * The first step still open, from data alone: no workspace, then no project, then the invite step.
 * A step the caller may not act on counts as done, so a member never waits on a button they lack.
 */
export function firstRunStep(state: {
  hasWorkspace: boolean;
  projectCount: number;
  mayConnect: boolean;
  mayInvite: boolean;
  inviteClosed: boolean;
}): FirstRunStep {
  if (!state.hasWorkspace) return "create";
  if (state.projectCount === 0 && state.mayConnect) return "mount";
  return state.mayInvite && !state.inviteClosed ? "invite" : "done";
}

/** Per browser: the invite step was skipped or finished. */
export const INVITE_CLOSED_KEY = "t3code:telescope:first-run-invite-closed:v1";

/**
 * Set when this session creates or joins a workspace from the first-run page, so the page stays up
 * for the steps after it. Not stored: a reload lands on the ordinary pages.
 */
export const firstRunHeldAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("telescope:first-run-held"),
);
