import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/cli";

import * as ContextPackService from "../telescope/pack/ContextPackService.ts";
import { HARNESSES } from "../telescope/pack/Pack.ts";

const exportCommand = Command.make("export", {
  projectDir: Argument.String("projectDir").pipe(
    Argument.withDescription("Project whose agent context to export."),
  ),
  out: Flag.String("out").pipe(Flag.withDescription("Directory to write the pack to.")),
}).pipe(
  Command.withDescription("Export instructions, skills, and MCP servers as a context pack."),
  Command.withHandler(
    Effect.fn("cli.pack.export")(function* ({ projectDir, out }) {
      const service = yield* ContextPackService.ContextPackService;
      const { instructions, skills, servers } = yield* service.export(projectDir, out);
      yield* Console.log(
        `Exported ${instructions ? "instructions, " : ""}${skills} skills and ${servers} MCP servers from ${projectDir} to ${out}.`,
      );
    }),
  ),
);

const importCommand = Command.make("import", {
  packDir: Argument.String("packDir").pipe(Argument.withDescription("Context pack directory.")),
  projectDir: Argument.String("projectDir").pipe(
    Argument.withDescription("Project to write the harness files into."),
  ),
  harness: Flag.Literals("harness", HARNESSES).pipe(
    Flag.withDescription("Harness whose native files to write."),
  ),
  merge: Flag.Boolean("merge").pipe(
    Flag.withDescription("Keep existing harness content and add the pack's on top."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Write a context pack as a harness's native files."),
  Command.withHandler(
    Effect.fn("cli.pack.import")(function* ({ packDir, projectDir, harness, merge }) {
      const service = yield* ContextPackService.ContextPackService;
      yield* service.import(packDir, projectDir, harness, merge);
      yield* Console.log(`Imported ${packDir} into ${projectDir} for ${harness}.`);
    }),
  ),
);

export const packCommand = Command.make("pack").pipe(
  Command.withDescription("Move agent context between projects and harnesses."),
  Command.withSubcommands([exportCommand, importCommand]),
  Command.provide(ContextPackService.layer),
);
