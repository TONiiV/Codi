import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type Telescope } from "@t3tools/contracts";

import { workerModel } from "./WorkerDispatch.ts";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claude");
const ruled = { instanceId: claude, model: "rule-model" };
const fallback = { instanceId: codex, model: "default-model" };
const resolution = (
  source: Telescope.RoutingResolution["source"],
  modelSelection?: typeof ruled,
): Telescope.RoutingResolution => ({
  source,
  ...(modelSelection === undefined ? {} : { modelSelection }),
  skipped: [],
});

describe("workerModel", () => {
  it.each([
    ["a rule", resolution("rule", ruled), fallback, undefined, ruled],
    ["the agent's model", resolution("agent_default", ruled), fallback, undefined, ruled],
    ["none: the default, no allowlist", resolution("none"), fallback, undefined, fallback],
    ["none: the default, an empty allowlist", resolution("none"), fallback, {}, fallback],
    [
      "none: the default inside the allowlist",
      resolution("none"),
      fallback,
      { harnesses: [codex], models: ["default-model"] },
      fallback,
    ],
    [
      "none: the default's model outside the allowlist",
      resolution("none"),
      fallback,
      { models: ["rule-model"] },
      undefined,
    ],
    [
      "none: the default's harness outside the allowlist",
      resolution("none"),
      fallback,
      { harnesses: [claude] },
      undefined,
    ],
    ["none: no default", resolution("none"), null, undefined, undefined],
    [
      "none_allowed, even with a default",
      resolution("none_allowed"),
      fallback,
      undefined,
      undefined,
    ],
  ] as const)("%s", (_, route, defaultModel, allowlist, expected) => {
    expect(workerModel(route, defaultModel, allowlist)).toEqual(expected);
  });
});
