/**
 * UsageLimitResumeReactor - Restarts turns their provider's usage limit stopped.
 *
 * A session parked behind a usage limit carries the instant the window
 * reopens. This reactor is the thing that actually shows up at that instant
 * and asks the turn to run again.
 *
 * @module UsageLimitResumeReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * UsageLimitResumeReactorShape - Service API for usage-limit auto-resume.
 */
export interface UsageLimitResumeReactorShape {
  /**
   * Start watching sessions for usage-limit pauses and resuming them when
   * their reset time arrives. Rebuilds the schedule from the projection first,
   * so a pause outlives a server restart the way the limit it waits on does.
   *
   * The returned effect must be run in a scope so pending timers are finalized
   * on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

/**
 * UsageLimitResumeReactor - Service tag for usage-limit auto-resume.
 */
export class UsageLimitResumeReactor extends Context.Service<
  UsageLimitResumeReactor,
  UsageLimitResumeReactorShape
>()("t3/orchestration/Services/UsageLimitResumeReactor") {}
