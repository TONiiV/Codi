import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import { type ModelSelection, ProviderDriverKind } from "@t3tools/contracts";
import { DeepSeekSettings } from "../settings.ts";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import type * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import type * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import type * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { makeDeepSeekAcpRuntime } from "./acpSupport.ts";

const DEEPSEEK_PROVIDER = ProviderDriverKind.make("deepseek");
const DEEPSEEK_MODEL_CONFIG_ID = "model";
const DEFAULT_DEEPSEEK_SETTINGS = Schema.decodeSync(DeepSeekSettings)({});

export function deepSeekModelConfigValue(model: string): string {
  return JSON.stringify(["deepseek-official", model]);
}

export interface DeepSeekAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: DeepSeekSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly selfInvocation: SelfInvocation;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  >;
}

const applyDeepSeekModel = Effect.fn("DeepSeekAdapterV2.applyModelSelection")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
) {
  const requested = modelSelection.model.trim();
  if (requested.length === 0 || requested === "default") return undefined;
  yield* runtime.setConfigOption(DEEPSEEK_MODEL_CONFIG_ID, deepSeekModelConfigValue(requested), {
    allowUnlistedValue: true,
  });
  return requested;
});

/** Writes a non-default model selection to dsh's `model` session option; "default" leaves dsh's own choice. */
const applyDeepSeekModelSelection: NonNullable<AcpAdapterV2Flavor["applyModelSelection"]> = ({
  runtime,
  modelSelection,
}) => applyDeepSeekModel(runtime, modelSelection);

/** dsh exposes only the standard ACP surface, so the flavor carries no provider-specific behavior. */
function makeDeepSeekAcpAdapterFlavor(options: DeepSeekAdapterV2Options): AcpAdapterV2Flavor {
  const makeRuntime =
    options.makeRuntime ??
    ((input: AcpAdapterV2RuntimeInput) => {
      const { runtimePolicy, processEnvironment, ...runtimeInput } = input;
      return makeDeepSeekAcpRuntime({
        ...runtimeInput,
        settings: options.settings,
        environment: { ...options.environment, ...processEnvironment },
        runtimeMode: runtimePolicy.runtimeMode,
      });
    });
  return {
    driver: DEEPSEEK_PROVIDER,
    runtimeHarness: "DeepSeek",
    capabilities: AcpProviderCapabilitiesV2,
    makeRuntime,
    applyModelSelection: applyDeepSeekModelSelection,
    promptFailure: (cause) => makeProviderFailure({ cause, class: "provider_error" }),
  };
}

const makeDeepSeekAdapterV2 = Effect.fn("makeDeepSeekAdapterV2")(function* (
  options: DeepSeekAdapterV2Options,
) {
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeDeepSeekAcpAdapterFlavor(options),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
  });
});

export type DeepSeekAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const makeDeepSeekAdapterV2Driver = (): ProviderAdapterDriver<
  DeepSeekSettings,
  DeepSeekAdapterV2DriverEnv
> => ({
  driverKind: DEEPSEEK_PROVIDER,
  configSchema: DeepSeekSettings,
  defaultConfig: (): DeepSeekSettings => DEFAULT_DEEPSEEK_SETTINGS,
  create: Effect.fn("DeepSeekAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<DeepSeekSettings>) {
      const hostEnvironment = yield* HostProcess.Environment;
      const selfInvocation = yield* resolveSelfInvocation();
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return yield* makeDeepSeekAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        selfInvocation,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: DEEPSEEK_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: DEEPSEEK_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create DeepSeek ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
});
