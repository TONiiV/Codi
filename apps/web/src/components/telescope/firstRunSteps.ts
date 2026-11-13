import { Atom } from "effect/reactivity";

export type FirstRunStep = "mount" | "invite" | "done";

/**
 * The step after the first one still open: no project, then the invite step.
 * A step the caller may not act on counts as done, so a member never waits on a button they lack.
 */
export function firstRunStep(state: {
  projectCount: number;
  mayConnect: boolean;
  mountPassed: boolean;
  mayInvite: boolean;
  inviteClosed: boolean;
}): FirstRunStep {
  if (state.projectCount === 0 && state.mayConnect && !state.mountPassed) return "mount";
  return state.mayInvite && !state.inviteClosed ? "invite" : "done";
}

/** Per browser: the invite step was skipped or finished. */
export const INVITE_CLOSED_KEY = "t3code:telescope:first-run-invite-closed:v1";

/**
 * The workspace whose first run this session started, from the first-run page's create or join.
 * Not stored: a reload lands on the ordinary pages. `mountPassed` once a project showed up or the
 * admin skipped the step, so removing a project later does not bring the step back.
 */
export const firstRunAtom = Atom.make<{ key: string; mountPassed: boolean } | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("telescope:first-run"),
);
