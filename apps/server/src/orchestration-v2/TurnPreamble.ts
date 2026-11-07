import type { MessageId, ModelSelection, ThreadId } from "@t3tools/contracts";
import { SKILL_MENTION_PATTERN } from "@t3tools/shared/composerInlineTokens";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface TurnPreambleInput {
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly modelSelection: ModelSelection;
  /** The provider's conversation holds no earlier turn, such as on a new or switched session. */
  readonly freshConversation: boolean;
}
type Contributor = (input: TurnPreambleInput) => Effect.Effect<string>;

// Providers parse a `/command`, or Grok a skill mention, only at the start of the prompt.
const LEADING_COMMAND = new RegExp(`^\\s*(?:/|${SKILL_MENTION_PATTERN.source})`, "u");
export const opensWithCommand = (text: string) => LEADING_COMMAND.test(text);

/**
 * Text a server module puts before a turn's prompt, as inline context every provider receives.
 * Telescope fills it for its agents' threads; the module that contributes is built after this.
 */
export class TurnPreamble extends Context.Service<
  TurnPreamble,
  {
    readonly forTurn: Contributor;
    readonly contribute: (contributor: Contributor) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/TurnPreamble") {}

export const layer = Layer.sync(TurnPreamble, () => {
  let current: Contributor = () => Effect.succeed("");
  return TurnPreamble.of({
    forTurn: Effect.fn("TurnPreamble.forTurn")(function* (input) {
      return yield* current(input);
    }),
    contribute: Effect.fn("TurnPreamble.contribute")(function* (contributor) {
      current = contributor;
    }),
  });
});
