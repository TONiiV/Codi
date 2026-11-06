import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ContextPackService from "./ContextPackService.ts";

const TestLayer = ContextPackService.layer.pipe(Layer.provideMerge(NodeServices.layer));

const fixture = Effect.fn(function* (files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-context-pack-" });
  for (const [rel, text] of Object.entries(files)) {
    yield* fs.makeDirectory(path.dirname(path.join(root, rel)), { recursive: true });
    yield* fs.writeFileString(path.join(root, rel), text);
  }
  const read = (rel: string) => fs.readFileString(path.join(root, rel));
  return { root, at: (rel: string) => path.join(root, rel), read };
});

const claudeProject = {
  "project/CLAUDE.md": "@AGENTS.md\n",
  "project/AGENTS.md": "# Rules\n\nRun the tests.\n",
  "project/.claude/skills/deploy/SKILL.md": "---\nname: deploy\n---\nShip it.\n",
  "project/.claude/skills/deploy/scripts/run.sh": "echo deploy\n",
  "project/.mcp.json": JSON.stringify({
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@github/mcp"],
        env: { GITHUB_TOKEN: "ghp_secret_value" },
      },
      docs: { type: "http", url: "https://docs.example.com/mcp" },
    },
  }),
};

describe("ContextPackService", () => {
  it.effect("round-trips claude to codex to cursor without copying env values", () =>
    Effect.gen(function* () {
      const service = yield* ContextPackService.ContextPackService;
      const dir = yield* fixture(claudeProject);

      expect(yield* service.export(dir.at("project"), dir.at("pack"))).toEqual({
        harness: "claude",
      });
      const manifest = JSON.parse(yield* dir.read("pack/pack.json"));
      expect(manifest).toMatchObject({
        version: 1,
        name: "project",
        source: { harness: "claude" },
        skills: ["deploy"],
      });
      expect(yield* dir.read("pack/instructions.md")).toContain("Run the tests.");
      expect(yield* dir.read("pack/skills/deploy/scripts/run.sh")).toBe("echo deploy\n");
      expect(JSON.parse(yield* dir.read("pack/mcp.json"))).toEqual({
        servers: {
          github: { command: "npx", args: ["-y", "@github/mcp"], env: ["GITHUB_TOKEN"] },
          docs: { url: "https://docs.example.com/mcp" },
        },
      });

      yield* service.import(dir.at("pack"), dir.at("codex"), "codex", false);
      expect(yield* dir.read("codex/AGENTS.md")).toContain("Run the tests.");
      expect(yield* dir.read("codex/.agents/skills/deploy/SKILL.md")).toContain("Ship it.");
      expect(yield* dir.read("codex/.codex/config.toml")).toBe(
        [
          "[mcp_servers.github]",
          'command = "npx"',
          'args = ["-y","@github/mcp"]',
          'env_vars = ["GITHUB_TOKEN"]',
          "",
          "[mcp_servers.docs]",
          'url = "https://docs.example.com/mcp"',
          "",
        ].join("\n"),
      );

      yield* service.export(dir.at("codex"), dir.at("pack2"));
      yield* service.import(dir.at("pack2"), dir.at("cursor"), "cursor", false);
      expect(yield* dir.read("cursor/.cursor/rules/context-pack.mdc")).toContain("Run the tests.");
      expect(yield* dir.read("cursor/.cursor/skills/deploy/scripts/run.sh")).toBe("echo deploy\n");
      expect(JSON.parse(yield* dir.read("cursor/.cursor/mcp.json"))).toEqual({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@github/mcp"],
            env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
          },
          docs: { url: "https://docs.example.com/mcp" },
        },
      });

      for (const file of ["pack/mcp.json", "codex/.codex/config.toml", "cursor/.cursor/mcp.json"]) {
        expect(yield* dir.read(file)).not.toContain("ghp_secret_value");
      }
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("merge keeps unrelated harness content", () =>
    Effect.gen(function* () {
      const service = yield* ContextPackService.ContextPackService;
      const dir = yield* fixture({
        ...claudeProject,
        "codex/AGENTS.md": "# Local notes\n",
        "codex/.codex/config.toml": [
          'model = "gpt"',
          "",
          "[mcp_servers.local]",
          'command = "local-mcp"',
          "",
          "[mcp_servers.local.env]",
          'LOCAL_KEY = "keep-me"',
          "",
          "[profiles.fast]",
          'model = "mini"',
        ].join("\n"),
        "opencode/opencode.json": JSON.stringify({
          theme: "dark",
          mcp: { mine: { type: "local" } },
        }),
      });
      yield* service.export(dir.at("project"), dir.at("pack"));

      yield* service.import(dir.at("pack"), dir.at("codex"), "codex", true);
      yield* service.import(dir.at("pack"), dir.at("codex"), "codex", true);
      const agents = yield* dir.read("codex/AGENTS.md");
      expect(agents.startsWith("# Local notes\n")).toBe(true);
      expect(agents.match(/Run the tests\./g)).toHaveLength(1);
      const toml = yield* dir.read("codex/.codex/config.toml");
      expect(toml).toContain('model = "gpt"');
      expect(toml).toContain('LOCAL_KEY = "keep-me"');
      expect(toml).toContain("[profiles.fast]");
      expect(toml.match(/\[mcp_servers\.github\]/g)).toHaveLength(1);

      yield* service.import(dir.at("pack"), dir.at("opencode"), "opencode", true);
      const opencode = JSON.parse(yield* dir.read("opencode/opencode.json"));
      expect(opencode.theme).toBe("dark");
      expect(Object.keys(opencode.mcp).toSorted()).toEqual(["docs", "github", "mine"]);
      expect(opencode.mcp.github).toEqual({
        type: "local",
        command: ["npx", "-y", "@github/mcp"],
        environment: { GITHUB_TOKEN: "{env:GITHUB_TOKEN}" },
      });

      yield* service.import(dir.at("pack"), dir.at("codex"), "codex", false);
      const replaced = yield* dir.read("codex/.codex/config.toml");
      expect(replaced).toContain("[profiles.fast]");
      expect(replaced).not.toContain("[mcp_servers.local");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
