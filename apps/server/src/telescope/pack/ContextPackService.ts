import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { claude, claudeHome } from "./harnesses/claude.ts";
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
  isInside,
  type McpServers,
  type Pack,
  PACK_FILES,
  type PackScope,
  readPackDir,
  writePackDir,
} from "./Pack.ts";

type Harnesses = Record<HarnessName, Harness>;

const PROJECT_HARNESSES: Harnesses = {
  claude: claude({ instructions: "CLAUDE.md", skillsDirs: [".claude/skills"], mcp: ".mcp.json" }),
  codex: codex({
    instructions: "AGENTS.md",
    skillsDirs: [".agents/skills"],
    mcp: ".codex/config.toml",
  }),
  cursor: cursor({
    instructions: ".cursor/rules",
    skillsDirs: [".cursor/skills"],
    mcp: ".cursor/mcp.json",
  }),
  opencode: opencode({
    instructions: "AGENTS.md",
    skillsDirs: [".agents/skills", ".opencode/skills"],
    mcp: "opencode.json",
  }),
};

// `codexHome` and `configHome` are CODEX_HOME and XDG_CONFIG_HOME relative to the home.
const homeHarnesses = (codexHome: string, configHome: string): Harnesses => ({
  claude: claudeHome({
    instructions: ".claude/CLAUDE.md",
    skillsDirs: [".claude/skills"],
    mcp: ".claude.json",
  }),
  codex: codex({
    instructions: `${codexHome}/AGENTS.md`,
    skillsDirs: [".agents/skills"],
    mcp: `${codexHome}/config.toml`,
  }),
  cursor: cursor({
    instructions: { settings: "Cursor Settings > Rules" },
    skillsDirs: [".cursor/skills"],
    mcp: ".cursor/mcp.json",
  }),
  opencode: opencode({
    instructions: `${configHome}/opencode/AGENTS.md`,
    skillsDirs: [".agents/skills", `${configHome}/opencode/skills`],
    mcp: `${configHome}/opencode/opencode.json`,
  }),
});
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

type PackError =
  | PlatformError
  | ContextPackFormatError
  | ContextPackOverlapError
  | ContextPackPathError;

export class ContextPackService extends Context.Service<
  ContextPackService,
  {
    readonly export: (
      dir: string,
      outDir: string,
      scope?: PackScope,
    ) => Effect.Effect<
      { readonly instructions: boolean; readonly skills: number; readonly servers: number },
      PackError | ContextPackNoHarnessError | ContextPackOutDirError
    >;
    readonly import: (
      packDir: string,
      dir: string,
      harness: HarnessName,
      merge: boolean,
      scope?: PackScope,
    ) => Effect.Effect<void, PackError>;
  }
>()("t3/telescope/pack/ContextPackService") {}

const make = Effect.gen(function* () {
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // Untraced: runs inside the export and import spans. An override is used only inside the home,
  // so a pack for another home never writes this one's.
  const homeDirFrom = Effect.fnUntraced(function* (home: string, name: string, fallback: string) {
    const value = yield* Config.String(name).pipe(
      Config.withDefault(""),
      Effect.orElseSucceed(() => ""),
    );
    if (value === "") return fallback;
    const dir = path.resolve(value);
    if (isInside(path, home, dir)) return path.relative(home, dir) || ".";
    yield* Effect.logWarning(
      `Ignored ${name}: ${value} is not inside ${home}, so ${fallback} is used.`,
    );
    return fallback;
  });

  const harnessesFor = Effect.fnUntraced(function* (scope: PackScope, dir: string) {
    if (scope === "project") return PROJECT_HARNESSES;
    return homeHarnesses(
      yield* homeDirFrom(dir, "CODEX_HOME", ".codex"),
      yield* homeDirFrom(dir, "XDG_CONFIG_HOME", ".config"),
    );
  });

  // A project is owned whole; in a home directory only the harness files are, so a pack can live
  // beside them.
  const assertApart = (
    packDir: string,
    dir: string,
    scope: PackScope,
    harnesses: ReadonlyArray<Harness>,
  ) =>
    scope === "project"
      ? assertSeparate(packDir, dir)
      : Effect.forEach(
          harnesses.flatMap((harness) => harness.owned),
          (owned) => assertSeparate(packDir, path.join(dir, owned)),
          { discard: true },
        );

  const exportPack = Effect.fn("ContextPackService.export")(function* (
    dir: string,
    outDir: string,
    scope: PackScope = "project",
  ) {
    const root = yield* fs.realPath(path.resolve(dir));
    const harnesses = yield* harnessesFor(scope, path.resolve(dir));
    const ordered = EXPORT_ORDER.map((name) => harnesses[name]);
    yield* assertApart(path.resolve(outDir), root, scope, ordered);
    let instructions = "";
    const skills: Array<Pack["skills"][number]> = [];
    const mcp: Record<string, McpServers[string]> = {};
    for (const harness of ordered) {
      const pack = yield* harness.read(root);
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
    scope: PackScope = "project",
  ) {
    const target = (yield* harnessesFor(scope, path.resolve(dir)))[harness];
    yield* assertApart(path.resolve(packDir), path.resolve(dir), scope, [target]);
    const pack = yield* readPackDir(path.resolve(packDir));
    yield* target.write(pack, path.resolve(dir), merge);
    if (target.settings !== undefined && pack.instructions.trim() !== "") {
      const text = path.join(path.resolve(packDir), PACK_FILES.instructions);
      yield* Effect.logWarning(
        `Left out the instructions: they go in ${target.settings}, not in a file under ${path.resolve(dir)}. Paste the text of ${text} there.`,
      );
    }
  }, Effect.provide(context));

  return ContextPackService.of({ export: exportPack, import: importPack });
});

export const layer = Layer.effect(ContextPackService, make);
