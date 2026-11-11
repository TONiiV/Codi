import type { RuntimeMode } from "@t3tools/contracts";
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

const DEEPSEEK_PERMISSION_MODE: Record<RuntimeMode, string> = {
  "approval-required": "read-only",
  "auto-accept-edits": "workspace-write",
  auto: "workspace-write",
  "full-access": "danger-full-access",
};

type DeepSeekAcpRuntimeSettings = Pick<DeepSeekSettings, "binaryPath">;

export function buildDeepSeekAcpSpawnInput(
  settings: DeepSeekAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  runtimeMode?: RuntimeMode,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: settings?.binaryPath || "dsh",
    args: [...DEEPSEEK_ACP_ARGS],
    cwd,
    ...(environment === undefined && runtimeMode === undefined
      ? {}
      : {
          env: {
            ...environment,
            ...(runtimeMode === undefined
              ? {}
              : { DSH_PERMISSION_MODE: DEEPSEEK_PERMISSION_MODE[runtimeMode] }),
          },
        }),
  };
}

export interface DeepSeekAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly settings: DeepSeekAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode?: RuntimeMode;
}

export const makeDeepSeekAcpRuntime = Effect.fn("DeepSeekAcpSupport.makeDeepSeekAcpRuntime")(
  function* (
    input: DeepSeekAcpRuntimeInput,
  ): Effect.fn.Return<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  > {
    const { settings, environment, runtimeMode, ...runtimeOptions } = input;
    const context = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...runtimeOptions,
        spawn: buildDeepSeekAcpSpawnInput(settings, input.cwd, environment, runtimeMode),
      }),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
  },
);
