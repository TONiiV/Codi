import type { McpServer, McpServers } from "../Pack.ts";
import { makeHarness, markdownInstructions, stringAt, stringsAt } from "../Pack.ts";

// No TOML parser ships with the server; Codex writes `mcp_servers` with string scalars and
// single-line arrays, whose literals are JSON. Everything outside those tables is kept verbatim.
const HEADER = /^\s*\[\s*mcp_servers\.("[^"]+"|[\w-]+)(\.[\w.-]+)?\s*\]\s*$/;
const ANY_HEADER = /^\s*\[/;
const unquote = (name: string) =>
  name.startsWith('"') ? (stringAt(JSON.parse(name)) ?? name) : name;
const keyOf = (name: string) => (/^[\w-]+$/.test(name) ? name : JSON.stringify(name));

const splitServers = (text: string) => {
  const blocks = new Map<string, Array<string>>();
  const rest: Array<string> = [];
  let current: Array<string> = rest;
  for (const line of text.split("\n")) {
    const header = HEADER.exec(line);
    if (header) {
      const name = unquote(header[1]!);
      current = blocks.get(name) ?? [];
      blocks.set(name, current);
    } else if (ANY_HEADER.test(line)) {
      current = rest;
    }
    current.push(line);
  }
  return { blocks, rest };
};

const parseServer = (lines: ReadonlyArray<string>): McpServer => {
  const server: { -readonly [K in keyof McpServer]: McpServer[K] } = {};
  const env = new Set<string>();
  let inEnv = false;
  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) {
      inEnv = header[2] === ".env";
      continue;
    }
    const match = /^\s*("[^"]+"|[\w-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const key = unquote(match[1]!);
    const value = match[2]!;
    const parsed = (): unknown => JSON.parse(value);
    if (inEnv) env.add(key);
    else if (key === "command" || key === "url") server[key] = stringAt(parsed());
    else if (key === "args") server.args = stringsAt(parsed());
    else if (key === "env_vars") for (const name of stringsAt(parsed()) ?? []) env.add(name);
    else if (key === "env") {
      for (const m of value.matchAll(/[{,]\s*("[^"]+"|[\w-]+)\s*=/g)) env.add(unquote(m[1]!));
    }
  }
  return env.size > 0 ? { ...server, env: [...env] } : server;
};

// Codex passes `env` values literally, so env names become `env_vars`, which it forwards.
const renderServer = (name: string, server: McpServer) =>
  [
    `[mcp_servers.${keyOf(name)}]`,
    ...(["command", "args", "url"] as const).flatMap((key) =>
      server[key] === undefined ? [] : [`${key} = ${JSON.stringify(server[key])}`],
    ),
    ...(server.env?.length ? [`env_vars = ${JSON.stringify(server.env)}`] : []),
  ].join("\n");

const writeServers = (existing: string | undefined, servers: McpServers, merge: boolean) => {
  const { blocks, rest } = splitServers(existing ?? "");
  const kept = merge ? [...blocks].filter(([name]) => !(name in servers)) : [];
  const sections = [
    rest.join("\n").trimEnd(),
    ...kept.map(([, lines]) => lines.join("\n").trimEnd()),
    ...Object.entries(servers).map(([name, server]) => renderServer(name, server)),
  ].filter((section) => section !== "");
  return `${sections.join("\n\n")}\n`;
};

export const codex = makeHarness({
  markers: [".codex", "AGENTS.md"],
  instructions: markdownInstructions("AGENTS.md"),
  skillsDir: ".agents/skills",
  mcp: {
    file: ".codex/config.toml",
    read: (text) =>
      Object.fromEntries(
        [...splitServers(text).blocks].map(([n, lines]) => [n, parseServer(lines)]),
      ),
    write: writeServers,
  },
});
