import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { DeepSeekSettings } from "../settings.ts";
import { buildDeepSeekAcpSpawnInput } from "./acpSupport.ts";
import { deepSeekAuthFromEnvironment } from "./status.ts";

const decodeSettings = Schema.decodeUnknownSync(DeepSeekSettings);

describe("DeepSeekDriver", () => {
  it("launches the ACP profile from the configured binary", () => {
    assert.deepEqual(buildDeepSeekAcpSpawnInput(decodeSettings({}), "/work"), {
      command: "dsh",
      args: ["--profile", "acp"],
      cwd: "/work",
    });
    const custom = buildDeepSeekAcpSpawnInput(
      decodeSettings({ binaryPath: "/opt/dsh/bin/dsh" }),
      "/work",
      { DEEPSEEK_API_KEY: "sk-test" },
    );
    assert.equal(custom.command, "/opt/dsh/bin/dsh");
    assert.deepEqual(custom.args, ["--profile", "acp"]);
    assert.deepEqual(custom.env, { DEEPSEEK_API_KEY: "sk-test" });
  });

  it("reads the sign-in state from the DEEPSEEK_API_KEY environment variable", () => {
    assert.deepEqual(deepSeekAuthFromEnvironment({}), { status: "unauthenticated" });
    assert.deepEqual(deepSeekAuthFromEnvironment({ DEEPSEEK_API_KEY: "" }), {
      status: "unauthenticated",
    });
    assert.deepEqual(deepSeekAuthFromEnvironment({ DEEPSEEK_API_KEY: "sk-test" }), {
      status: "authenticated",
      type: "api_key",
      label: "DeepSeek API key",
    });
  });
});
