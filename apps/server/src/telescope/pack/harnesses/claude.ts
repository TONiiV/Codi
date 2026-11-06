import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  bearerHeaders,
  envPlaceholders,
  jsonMcp,
  makeHarness,
  markdownInstructions,
  readOptionalText,
} from "../Pack.ts";

const claudeMd = markdownInstructions("CLAUDE.md");

// Untraced: runs inside the ContextPackService.export span.
// CLAUDE.md often only imports AGENTS.md (`@AGENTS.md`); inline those lines so the pack is complete.
const readInlined = Effect.fnUntraced(function* (dir: string) {
  const path = yield* Path.Path;
  const text = yield* claudeMd.read(dir);
  if (text === undefined) return undefined;
  const lines: Array<string> = [];
  for (const line of text.split("\n")) {
    const target = /^@(\S+\.md)\s*$/.exec(line)?.[1];
    const imported = target ? yield* readOptionalText(path.resolve(dir, target)) : undefined;
    lines.push(imported?.trimEnd() ?? line);
  }
  return lines.join("\n");
});

export const claude = makeHarness({
  instructions: { read: readInlined, write: claudeMd.write },
  skillsDirs: [".claude/skills"],
  mcp: jsonMcp(".mcp.json", "mcpServers", (server) =>
    server.url !== undefined
      ? {
          type: server.transport ?? "http",
          url: server.url,
          headers: bearerHeaders(server.bearerTokenEnv, (name) => `\${${name}}`),
        }
      : {
          command: server.command,
          args: server.args,
          env: envPlaceholders(server.env, (name) => `\${${name}}`),
        },
  ),
});
