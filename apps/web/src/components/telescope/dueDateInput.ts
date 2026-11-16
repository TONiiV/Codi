import { Telescope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isDueDate = Schema.is(Telescope.TaskDueDate);

/**
 * What a `type="date"` input holds once the member is done with it: a day to store, `null` to
 * clear it, or `undefined` for no change (half filled, or a day the board would refuse).
 */
export function enteredDueDate(input: HTMLInputElement) {
  // A half-filled date also reads as "", and only `badInput` tells it from an emptied one.
  if (input.value === "") return input.validity.badInput ? undefined : null;
  return isDueDate(input.value) ? input.value : undefined;
}
