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
      // The pack rule belongs to the pack that wrote it, like a context-pack block.
      for (const file of (yield* ruleFiles(rules)).filter((f) => f !== PACK_RULE)) {
        bodies.push(ruleBody(yield* fs.readFileString(path.join(rules, file))));
      }
      return bodies.length === 0 ? undefined : bodies.join("\n\n");
    }),
    // Only the pack rule is written, so the project's other rules survive in either mode.
    write: Effect.fnUntraced(function* (dir, text, merge) {
      const fs = yield* FileSystem.FileSystem;
      const target = (yield* Path.Path).join(dir, RULES, PACK_RULE);
      const existing = (yield* fs.exists(target))
        ? (yield* fs.readFileString(target)).replace(FRONTMATTER, "")
        : undefined;
      const body = mergeInstructions(existing, text, merge).trimEnd();
      yield* writeText(target, `${PACK_RULE_HEADER}${body}\n`);
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
