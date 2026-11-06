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
  assertSeparate,
  type ContextPackFormatError,
  type ContextPackOutDirError,
  type ContextPackOverlapError,
  type ContextPackPathError,
  type Harness,
  type HarnessName,
  type McpServers,
  type Pack,
  readPackDir,
  writePackDir,
} from "./Pack.ts";

const HARNESS_BY_NAME: Record<HarnessName, Harness> = { claude, codex, cursor, opencode };
// Every harness present contributes; earlier ones win on instructions and on name clashes.
// OpenCode and Codex both read AGENTS.md, so the first non-empty instructions are used.
const EXPORT_ORDER: ReadonlyArray<HarnessName> = ["claude", "opencode", "cursor", "codex"];

export class ContextPackNoHarnessError extends Schema.TaggedError<ContextPackNoHarnessError>()(
  "ContextPackNoHarnessError",
  { dir: Schema.String },
) {
  override get message(): string {
    return `No agent instructions, skills, or MCP config found in ${this.dir}.`;
  }
}

type PackError = PlatformError | ContextPackFormatError | ContextPackOverlapError;

export class ContextPackService extends Context.Service<
  ContextPackService,
  {
    readonly export: (
      dir: string,
      outDir: string,
    ) => Effect.Effect<
      { readonly instructions: boolean; readonly skills: number; readonly servers: number },
      PackError | ContextPackNoHarnessError | ContextPackOutDirError
    >;
    readonly import: (
      packDir: string,
      dir: string,
      harness: HarnessName,
      merge: boolean,
    ) => Effect.Effect<void, PackError | ContextPackPathError>;
  }
>()("t3/telescope/pack/ContextPackService") {}

const make = Effect.gen(function* () {
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const exportPack = Effect.fn("ContextPackService.export")(function* (
    dir: string,
    outDir: string,
  ) {
    const root = yield* fs.realPath(path.resolve(dir));
    yield* assertSeparate(path.resolve(outDir), root);
    let instructions = "";
    const skills: Array<Pack["skills"][number]> = [];
    const mcp: Record<string, McpServers[string]> = {};
    for (const harness of EXPORT_ORDER) {
      const pack = yield* HARNESS_BY_NAME[harness].read(root);
      if (instructions === "" && pack.instructions.trim() !== "") instructions = pack.instructions;
      skills.push(...pack.skills.filter((s) => !skills.some((k) => k.name === s.name)));
      for (const [name, server] of Object.entries(pack.mcp)) mcp[name] ??= server;
    }
    const summary = {
      instructions: instructions !== "",
      skills: skills.length,
      servers: Object.keys(mcp).length,
    };
    if (!summary.instructions && summary.skills === 0 && summary.servers === 0) {
      return yield* new ContextPackNoHarnessError({ dir: root });
    }
    yield* writePackDir({ instructions, skills, mcp }, path.resolve(outDir), {
      name: path.basename(root),
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
    return summary;
  }, Effect.provide(context));

  const importPack = Effect.fn("ContextPackService.import")(function* (
    packDir: string,
    dir: string,
    harness: HarnessName,
    merge: boolean,
  ) {
    yield* assertSeparate(path.resolve(packDir), path.resolve(dir));
    const pack = yield* readPackDir(path.resolve(packDir));
    yield* HARNESS_BY_NAME[harness].write(pack, path.resolve(dir), merge);
  }, Effect.provide(context));

  return ContextPackService.of({ export: exportPack, import: importPack });
});

export const layer = Layer.effect(ContextPackService, make);
