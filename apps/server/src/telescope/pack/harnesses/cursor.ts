import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { bearerHeaders, envPlaceholders, jsonMcp, makeHarness, writeText } from "../Pack.ts";

const RULES = ".cursor/rules";
const PACK_RULE = "context-pack.mdc";
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n*/;
// A rule scoped by globs keeps its scope as text, since the pack has one always-on instruction file.
const ruleBody = (text: string) => {
  const front = FRONTMATTER.exec(text)?.[1] ?? "";
  const body = text.replace(FRONTMATTER, "").trim();
  const globs = /^globs:\s*(.+)$/m.exec(front)?.[1]?.trim();
  const always = /^alwaysApply:\s*true\s*$/m.test(front);
  return globs && !always ? `Applies to files matching ${globs}:\n\n${body}` : body;
};

export const cursor = makeHarness({
  // Untraced: these run inside the ContextPackService.export/import spans.
  instructions: {
    read: Effect.fnUntraced(function* (dir) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rules = path.join(dir, RULES);
      if (!(yield* fs.exists(rules))) return undefined;
      const files = (yield* fs.readDirectory(rules)).filter((f) => f.endsWith(".mdc")).toSorted();
      const bodies: Array<string> = [];
      for (const file of files) {
        bodies.push(ruleBody(yield* fs.readFileString(path.join(rules, file))));
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
  skillsDirs: [".cursor/skills"],
  mcp: jsonMcp(".cursor/mcp.json", "mcpServers", (server) =>
    server.url !== undefined
      ? {
          url: server.url,
          headers: bearerHeaders(server.bearerTokenEnv, (name) => `\${env:${name}}`),
        }
      : {
          command: server.command,
          args: server.args,
          env: envPlaceholders(server.env, (name) => `\${env:${name}}`),
        },
  ),
});
