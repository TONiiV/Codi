import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { modelSelectionPatch } from "./myTeamsShared";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claude");
const stored = { instanceId: codex, model: "gpt-5", options: [{ id: "effort", value: "high" }] };

describe("modelSelectionPatch", () => {
  it.each([
    ["nothing picked keeps an agent on the default", undefined, undefined, {}],
    ["nothing picked keeps the stored model", undefined, stored, {}],
    [
      "re-picking the stored model keeps its options",
      { instanceId: codex, model: "gpt-5" },
      stored,
      {},
    ],
    ["another model", { instanceId: codex, model: "o3" }, stored, "send"],
    ["the same model on another harness", { instanceId: claude, model: "gpt-5" }, stored, "send"],
    [
      "a first pick for an agent on the default",
      { instanceId: claude, model: "opus" },
      undefined,
      "send",
    ],
  ] as const)("%s", (_, picked, current, expected) => {
    expect(modelSelectionPatch(picked, current)).toStrictEqual(
      expected === "send" ? { modelSelection: picked } : expected,
    );
  });
});
