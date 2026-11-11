import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "@t3tools/contracts";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as AcpErrors from "effect-acp/errors";

import { DeepSeekSettings } from "../settings.ts";
import { buildDeepSeekAcpSpawnInput } from "./acpSupport.ts";
import { applyDeepSeekModel } from "./adapter.ts";
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
  it.effect("selects a model by its Harness route and puts default on dsh's default route", () =>
    Effect.gen(function* () {
      const route = (model: string) => JSON.stringify(["deepseek-official", model]);
      // dsh's built-in catalog; like dsh, the fake rejects anything else but the current value.
      const listed = [route("deepseek-flash"), route("deepseek-v4-pro")];
      const modelOptions = (currentValue: string | undefined) =>
        currentValue === undefined
          ? []
          : [
              {
                id: "model",
                name: "Model",
                category: "model",
                type: "select",
                currentValue,
                options: listed.map((value) => ({ value, name: value })),
              },
            ];
      // `started` is the model the new, loaded, or resumed session reports at setup.
      const session = (started: string | undefined) => {
        let current = started;
        const writes: Array<string | boolean> = [];
        const runtime = {
          getConfigOptions: Effect.sync(() => modelOptions(current)),
          setConfigOption: (_configId: string, value: string | boolean) =>
            value !== current && !listed.includes(String(value))
              ? Effect.fail(
                  AcpErrors.AcpRequestError.invalidParams(`unknown model option: ${String(value)}`),
                )
              : Effect.sync(() => {
                  writes.push(value);
                  current = String(value);
                  return {};
                }),
        } as unknown as AcpSessionRuntime.AcpSessionRuntime["Service"];
        const startResult = {
          sessionSetupResult: { sessionId: "session-1", configOptions: modelOptions(started) },
        } as unknown as AcpSessionRuntime.AcpSessionRuntimeStartResult;
        const select = (model: string) =>
          applyDeepSeekModel({
            runtime,
            startResult,
            modelSelection: { instanceId: ProviderInstanceId.make("deepseek"), model },
          });
        return { select, writes };
      };

      // dsh's ACP profile starts new sessions on a route its catalog does not list.
      const fresh = session(route("deepseek-v4-flash"));
      yield* fresh.select("deepseek-v4-pro");
      yield* fresh.select("deepseek-v4-pro");
      yield* fresh.select("default");
      assert.deepEqual(fresh.writes, [route("deepseek-v4-pro"), route("deepseek-flash")]);

      const resumed = session(route("deepseek-v4-pro"));
      yield* resumed.select("deepseek-flash");
      assert.deepEqual(resumed.writes, [route("deepseek-flash")]);

      const resumedLegacy = session(route("deepseek-v4-pro"));
      yield* resumedLegacy.select("default");
      yield* resumedLegacy.select("");
      assert.deepEqual(resumedLegacy.writes, [route("deepseek-flash")]);

      const noModelOption = session(undefined);
      yield* noModelOption.select("default");
      assert.deepEqual(noModelOption.writes, [route("deepseek-flash")]);
    }),
  );
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
