import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { envPlaceholders, jsonMcp, makeHarness, writeText } from "../Pack.ts";

const RULES = ".cursor/rules";
const PACK_RULE = "context-pack.mdc";
const stripFrontmatter = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n*/, "");

export const cursor = makeHarness({
  markers: [".cursor"],
  instructions: {
    read: Effect.fnUntraced(function* (dir) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rules = path.join(dir, RULES);
      if (!(yield* fs.exists(rules))) return undefined;
      const files = (yield* fs.readDirectory(rules)).filter((f) => f.endsWith(".mdc")).toSorted();
      const bodies: Array<string> = [];
      for (const file of files) {
        bodies.push(stripFrontmatter(yield* fs.readFileString(path.join(rules, file))).trim());
      }
      return bodies.join("\n\n");
    }),
    // The pack owns one rule file, so other rules survive in either mode.
    write: Effect.fnUntraced(function* (dir, text) {
      const target = (yield* Path.Path).join(dir, RULES, PACK_RULE);
      const header =
        "---\ndescription: Project instructions from a context pack\nalwaysApply: true\n---\n\n";
      yield* writeText(target, header + text);
    }),
  },
  skillsDir: ".cursor/skills",
  mcp: jsonMcp(".cursor/mcp.json", "mcpServers", (server) =>
    server.url !== undefined
      ? { url: server.url }
      : {
          command: server.command,
          args: server.args,
          env: envPlaceholders(server.env, (name) => `\${env:${name}}`),
        },
  ),
});
