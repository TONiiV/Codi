import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveProviderUpdateRequired } from "./providerUpdateRequiredModels.ts";

describe("resolveProviderUpdateRequired", () => {
  it("names the runtime, prefixes the highest version with v and filters by the search", () => {
    const provider = {
      driver: ProviderDriverKind.make("codex"),
      updateRequiredModels: [
        { slug: "gpt-a", name: "GPT A", minVersion: "0.9.0" },
        { slug: "gpt-b", name: "GPT B", minVersion: "0.10.0" },
        { slug: "other", name: "Other", minVersion: "v1.2.0" },
      ],
    };

    expect(resolveProviderUpdateRequired(provider, " gpt ")).toEqual({
      providerName: "Codex CLI",
      version: "v0.10.0",
      modelNames: ["GPT A", "GPT B"],
    });
    expect(resolveProviderUpdateRequired(provider, "other")?.version).toBe("v1.2.0");
    expect(resolveProviderUpdateRequired(provider, "missing")).toBeNull();
  });
});
