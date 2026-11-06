import {
  bearerEnvAt,
  bearerHeaders,
  envPlaceholders,
  jsonMcp,
  keysAt,
  makeHarness,
  markdownInstructions,
  stringAt,
  stringsAt,
} from "../Pack.ts";

export const opencode = makeHarness({
  instructions: markdownInstructions("AGENTS.md"),
  skillsDirs: [".agents/skills", ".opencode/skills"],
  mcp: jsonMcp(
    "opencode.json",
    "mcp",
    (server) =>
      server.url !== undefined
        ? {
            type: "remote",
            url: server.url,
            headers: bearerHeaders(server.bearerTokenEnv, (name) => `{env:${name}}`),
          }
        : {
            type: "local",
            command: [server.command ?? "", ...(server.args ?? [])],
            environment: envPlaceholders(server.env, (name) => `{env:${name}}`),
          },
    (native) => {
      const command = stringsAt(native.command) ?? [];
      return {
        command: command[0],
        args: command.length > 1 ? command.slice(1) : undefined,
        env: keysAt(native.environment),
        url: stringAt(native.url),
        bearerTokenEnv: bearerEnvAt(native.headers),
      };
    },
  ),
});
