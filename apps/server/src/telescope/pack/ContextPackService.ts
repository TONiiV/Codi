import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { claude } from "./harnesses/claude.ts";
import { codex } from "./harnesses/codex.ts";
import { cursor } from "./harnesses/cursor.ts";
import { opencode } from "./harnesses/opencode.ts";
import {
  type ContextPackFormatError,
  type Harness,
  type HarnessName,
  readPackDir,
  writePackDir,
} from "./Pack.ts";

const HARNESS_BY_NAME: Record<HarnessName, Harness> = { claude, codex, cursor, opencode };
// Codex last: its AGENTS.md marker is also what OpenCode and Claude projects carry.
const DETECT_ORDER: ReadonlyArray<HarnessName> = ["claude", "opencode", "cursor", "codex"];

export class ContextPackNoHarnessError extends Schema.TaggedError<ContextPackNoHarnessError>()(
  "ContextPackNoHarnessError",
  { dir: Schema.String },
) {
  override get message(): string {
    return `No agent instructions, skills, or MCP config found in ${this.dir}.`;
  }
}

type PackError = PlatformError | ContextPackFormatError | Schema.SchemaError;

export class ContextPackService extends Context.Service<
  ContextPackService,
  {
    readonly export: (
      dir: string,
      outDir: string,
    ) => Effect.Effect<{ readonly harness: HarnessName }, PackError | ContextPackNoHarnessError>;
    readonly import: (
      packDir: string,
      dir: string,
      harness: HarnessName,
      merge: boolean,
    ) => Effect.Effect<void, PackError>;
  }
>()("t3/telescope/pack/ContextPackService") {}

const make = Effect.gen(function* () {
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const path = yield* Path.Path;

  const exportPack = Effect.fn("ContextPackService.export")(function* (
    dir: string,
    outDir: string,
  ) {
    const root = path.resolve(dir);
    for (const harness of DETECT_ORDER) {
      if (!(yield* HARNESS_BY_NAME[harness].detect(root))) continue;
      const pack = yield* HARNESS_BY_NAME[harness].read(root);
      yield* writePackDir(pack, path.resolve(outDir), {
        name: path.basename(root),
        createdAt: DateTime.formatIso(yield* DateTime.now),
        source: { harness, path: root },
      });
      return { harness };
    }
    return yield* new ContextPackNoHarnessError({ dir: root });
  }, Effect.provide(context));

  const importPack = Effect.fn("ContextPackService.import")(function* (
    packDir: string,
    dir: string,
    harness: HarnessName,
    merge: boolean,
  ) {
    const pack = yield* readPackDir(path.resolve(packDir));
    yield* HARNESS_BY_NAME[harness].write(pack, path.resolve(dir), merge);
  }, Effect.provide(context));

  return ContextPackService.of({ export: exportPack, import: importPack });
});

export const layer = Layer.effect(ContextPackService, make);
