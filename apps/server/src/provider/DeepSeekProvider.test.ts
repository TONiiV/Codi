import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DeepSeekSettings } from "@t3tools/provider-deepseek/settings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { checkDeepSeekProviderStatus } from "@t3tools/provider-deepseek/testing";

const encoder = new TextEncoder();
const enabled = Schema.decodeSync(DeepSeekSettings)({ enabled: true });
const disabled = Schema.decodeSync(DeepSeekSettings)({ enabled: false });

interface CliOutput {
  readonly stdout: string;
  readonly code: number;
}

function processHandle(output: CliOutput) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(900_000_002),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout:
      output.stdout.length === 0 ? Stream.empty : Stream.succeed(encoder.encode(output.stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function dshCli(outputs: Record<string, CliOutput>) {
  const invoked: Array<string> = [];
  const spawner = ChildProcessSpawner.make((command) => {
    const args = ChildProcess.isStandardCommand(command) ? command.args.join(" ") : "";
    invoked.push(args);
    return Effect.succeed(processHandle(outputs[args] ?? { stdout: "", code: 127 }));
  });
  return { invoked, spawner };
}

const check = (
  outputs: Record<string, CliOutput>,
  options: { readonly settings?: DeepSeekSettings; readonly environment?: NodeJS.ProcessEnv } = {},
) =>
  Effect.gen(function* () {
    const cli = dshCli(outputs);
    const snapshot = yield* checkDeepSeekProviderStatus(
      options.settings ?? enabled,
      options.environment ?? {},
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, cli.spawner));
    return { snapshot, invoked: cli.invoked };
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

describe("DeepSeekProvider", () => {
  it.effect("is disabled while the provider is off", () =>
    Effect.gen(function* () {
      const { snapshot, invoked } = yield* check({}, { settings: disabled });
      assert.equal(snapshot.status, "disabled");
      assert.deepEqual(invoked, []);
    }),
  );

  it.effect("reports a CLI whose version probe exits nonzero as failing to run", () =>
    Effect.gen(function* () {
      const { snapshot, invoked } = yield* check({
        "--version": { stdout: "dsh 0.2.1\n", code: 1 },
      });
      assert.equal(snapshot.status, "error");
      assert.isTrue(snapshot.installed);
      assert.equal(snapshot.message, "DeepSeek Harness is installed but failed to run.");
      // A broken CLI is not asked for anything else.
      assert.deepEqual(invoked, ["--version"]);
    }),
  );

  it.effect("asks for DEEPSEEK_API_KEY when it is missing", () =>
    Effect.gen(function* () {
      const { snapshot } = yield* check({ "--version": { stdout: "dsh 0.2.1\n", code: 0 } });
      assert.equal(snapshot.status, "error");
      assert.equal(snapshot.auth.status, "unauthenticated");
      assert.include(snapshot.message ?? "", "DEEPSEEK_API_KEY");
    }),
  );

  it.effect("is ready once DEEPSEEK_API_KEY is set", () =>
    Effect.gen(function* () {
      const { snapshot } = yield* check(
        { "--version": { stdout: "dsh 0.2.1\n", code: 0 } },
        { environment: { DEEPSEEK_API_KEY: "sk-test" } },
      );
      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.version, "0.2.1");
      assert.equal(snapshot.auth.status, "authenticated");
      assert.deepEqual(
        snapshot.models.map((model) => [model.slug, model.name]),
        [
          ["default", "DeepSeek default"],
          ["deepseek-flash", "DeepSeek-V4.1-Flash"],
          ["deepseek-v4-pro", "DeepSeek-V4-Pro"],
        ],
      );
      for (const model of snapshot.models) {
        assert.deepEqual(model.capabilities?.optionDescriptors, [
          {
            id: "reasoning_effort",
            label: "Reasoning",
            type: "select",
            role: "reasoning",
            currentValue: "high",
            options: [
              { id: "off", label: "Off" },
              { id: "low", label: "Low" },
              { id: "high", label: "High", isDefault: true },
              { id: "max", label: "Max" },
            ],
          },
        ]);
      }
    }),
  );
});
