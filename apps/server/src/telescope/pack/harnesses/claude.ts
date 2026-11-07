import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  bearerHeaders,
  envPlaceholders,
  jsonMcp,
  makeHarness,
  markdownInstructions,
  realPathInside,
} from "../Pack.ts";

const OMITTED_IMPORT =
  "(An import of a file outside the project was left out of this context pack.)";

// Untraced: runs inside the ContextPackService.export span.
// CLAUDE.md often only imports AGENTS.md (`@AGENTS.md`); inline those lines so the pack is complete.
const readInlined = Effect.fnUntraced(function* (dir: string, claudeMd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* markdownInstructions.read(dir, claudeMd);
  if (text === undefined) return undefined;
  const lines: Array<string> = [];
  for (const line of text.split("\n")) {
    const target = /^@(\S+\.md)\s*$/.exec(line)?.[1];
    // Claude resolves an import against the directory of the file that holds it.
    const file =
      target === undefined ? undefined : path.resolve(dir, path.dirname(claudeMd), target);
    const real = file === undefined ? undefined : yield* realPathInside(dir, file);
    if (real !== undefined) {
      lines.push((yield* fs.readFileString(real)).trimEnd());
    } else if (target !== undefined && path.isAbsolute(target)) {
      // An absolute path names the exporter's machine, so it stays out of a pack meant for sharing.
      yield* Effect.logWarning(`Left out @${target}: it resolves outside ${dir}.`);
      lines.push(OMITTED_IMPORT);
    } else {
      if (file !== undefined && (yield* fs.exists(file))) {
        yield* Effect.logWarning(`Kept @${target} as text: it resolves outside ${dir}.`);
      }
      lines.push(line);
    }
  }
  return lines.join("\n");
});

export const claude = makeHarness({
  instructions: { read: readInlined, write: markdownInstructions.write },
  mcp: jsonMcp("mcpServers", (server) =>
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
