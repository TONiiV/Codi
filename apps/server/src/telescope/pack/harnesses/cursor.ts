import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  bearerHeaders,
  envPlaceholders,
  jsonMcp,
  makeHarness,
  mergeInstructions,
  writeText,
} from "../Pack.ts";

const RULES = ".cursor/rules";
const PACK_RULE = "context-pack.mdc";
const PACK_RULE_HEADER =
  "---\ndescription: Project instructions from a context pack\nalwaysApply: true\n---\n\n";
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n*/;
// A rule scoped by globs keeps its scope as text, since the pack has one always-on instruction file.
const ruleBody = (text: string) => {
  const front = FRONTMATTER.exec(text)?.[1] ?? "";
  const body = text.replace(FRONTMATTER, "").trim();
  const globs = /^globs:\s*(.+)$/m.exec(front)?.[1]?.trim();
  const always = /^alwaysApply:\s*true\s*$/m.test(front);
  return globs && !always ? `Applies to files matching ${globs}:\n\n${body}` : body;
};

const ruleFiles = Effect.fnUntraced(function* (rules: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(rules))) return [];
  return (yield* fs.readDirectory(rules)).filter((f) => f.endsWith(".mdc")).toSorted();
});

export const cursor = makeHarness({
  // Untraced: these run inside the ContextPackService.export/import spans.
  instructions: {
    read: Effect.fnUntraced(function* (dir) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rules = path.join(dir, RULES);
      const bodies: Array<string> = [];
      for (const file of yield* ruleFiles(rules)) {
        bodies.push(ruleBody(yield* fs.readFileString(path.join(rules, file))));
      }
      return bodies.length === 0 ? undefined : bodies.join("\n\n");
    }),
    // The pack rule plays the instruction file's part: merge keeps the other rules and swaps only
    // the pack's block, otherwise the pack's text replaces the project's rules.
    write: Effect.fnUntraced(function* (dir, text, merge) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rules = path.join(dir, RULES);
      const target = path.join(rules, PACK_RULE);
      for (const file of merge ? [] : yield* ruleFiles(rules)) {
        if (file !== PACK_RULE) yield* fs.remove(path.join(rules, file));
      }
      const existing = (yield* fs.exists(target))
        ? (yield* fs.readFileString(target)).replace(FRONTMATTER, "")
        : undefined;
      yield* writeText(target, PACK_RULE_HEADER + mergeInstructions(existing, text, merge));
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
