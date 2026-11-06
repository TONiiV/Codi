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
            // OpenCode negotiates the transport itself and ignores keys outside its schema, so
            // this is where the pack's SSE marker survives until the next export.
            transport: server.transport,
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
        transport: native.transport === "sse" ? "sse" : undefined,
        bearerTokenEnv: bearerEnvAt(native.headers),
      };
    },
  ),
});
