import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DeepSeekSettings } from "../settings.ts";
import { buildDeepSeekAcpSpawnInput } from "./acpSupport.ts";
import { deepSeekModelConfigValue } from "./adapter.ts";
import { DEEPSEEK_UPDATE } from "./driver.ts";
import { deepSeekAuthFromEnvironment } from "./status.ts";

const decodeSettings = Schema.decodeUnknownSync(DeepSeekSettings);

describe("DeepSeekDriver", () => {
  it.effect("updates a globally installed dsh through its package manager", () =>
    Effect.gen(function* () {
      const capabilities = yield* DEEPSEEK_UPDATE.resolve({
        binaryPath: "dsh",
        resolvedCommandPath: "/opt/node/bin/dsh",
        realCommandPath: "/opt/node/lib/node_modules/@deepseek-ai/dsh/lib/bin.js",
        env: {},
        platform: "linux",
      });
      assert.equal(capabilities.packageName, "@deepseek-ai/dsh");
      assert.deepEqual(capabilities.update?.args, [
        "install",
        "-g",
        "--prefix",
        "/opt/node",
        "--allow-scripts=@deepseek-ai/dsh",
        "@deepseek-ai/dsh@latest",
      ]);
      const vitePlusNodeGlobal = yield* DEEPSEEK_UPDATE.resolve({
        binaryPath: "dsh",
        resolvedCommandPath: "/home/dev/.local/share/vite-plus/bin/dsh",
        realCommandPath:
          "/home/dev/.local/share/vite-plus/js_runtime/node/26.13.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js",
        env: {},
        platform: "linux",
      });
      assert.equal(vitePlusNodeGlobal.update?.executable, "npm");
      assert.deepEqual(vitePlusNodeGlobal.update?.args, [
        "install",
        "-g",
        "--prefix",
        "/home/dev/.local/share/vite-plus/js_runtime/node/26.13.0",
        "--allow-scripts=@deepseek-ai/dsh",
        "@deepseek-ai/dsh@latest",
      ]);
      const sourceCheckout = yield* DEEPSEEK_UPDATE.resolve({
        binaryPath: "dsh",
        resolvedCommandPath: "/home/dev/.local/bin/dsh",
        realCommandPath: "/home/dev/deepseek-harness/apps/cli/lib/bin.js",
        env: {},
        platform: "linux",
      });
      assert.equal(sourceCheckout.update, null);
      assert.equal(sourceCheckout.installPath, "/home/dev/deepseek-harness/apps/cli/lib/bin.js");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  it("uses the Harness ACP route value for a selected model", () => {
    assert.equal(
      deepSeekModelConfigValue("deepseek-v4-pro"),
      '["deepseek-official","deepseek-v4-pro"]',
    );
  });
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
    for (const [mode, preset] of [
      ["approval-required", "read-only"],
      ["auto-accept-edits", "workspace-write"],
      ["auto", "workspace-write"],
      ["full-access", "danger-full-access"],
    ] as const) {
      assert.deepEqual(
        buildDeepSeekAcpSpawnInput(
          decodeSettings({}),
          "/work",
          { DSH_PERMISSION_MODE: "danger-full-access" },
          mode,
        ).env,
        { DSH_PERMISSION_MODE: preset },
      );
    }
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
