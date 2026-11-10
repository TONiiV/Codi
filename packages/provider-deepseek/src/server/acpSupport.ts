import type { DeepSeekSettings } from "../settings.ts";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

/** `dsh` serves its ACP v1 agent over stdio when launched with this profile. */
const DEEPSEEK_ACP_ARGS = ["--profile", "acp"] as const;

type DeepSeekAcpRuntimeSettings = Pick<DeepSeekSettings, "binaryPath">;

export function buildDeepSeekAcpSpawnInput(
  settings: DeepSeekAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: settings?.binaryPath || "dsh",
    args: [...DEEPSEEK_ACP_ARGS],
    cwd,
    ...(environment === undefined ? {} : { env: environment }),
  };
}

export interface DeepSeekAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly settings: DeepSeekAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeDeepSeekAcpRuntime = Effect.fn("DeepSeekAcpSupport.makeDeepSeekAcpRuntime")(
  function* (
    input: DeepSeekAcpRuntimeInput,
  ): Effect.fn.Return<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  > {
    const { settings, environment, ...runtimeOptions } = input;
    const context = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...runtimeOptions,
        spawn: buildDeepSeekAcpSpawnInput(settings, input.cwd, environment),
      }),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
  },
);
