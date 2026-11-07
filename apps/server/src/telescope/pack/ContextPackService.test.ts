import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { packCommand } from "../../cli/pack.ts";
import * as ContextPackService from "./ContextPackService.ts";

const TestLayer = ContextPackService.layer.pipe(
  Layer.provideMerge(Layer.merge(NodeServices.layer, TestConsole.layer)),
);

const runCli = (args: ReadonlyArray<string>) =>
  Command.runWith(packCommand, { version: "0.0.0" })(args);

const fixture = Effect.fn(function* (
  files: Record<string, string>,
  links: Record<string, string> = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-context-pack-" });
  const parent = (rel: string) =>
    fs.makeDirectory(path.dirname(path.join(root, rel)), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    yield* parent(rel);
    yield* fs.writeFileString(path.join(root, rel), text);
  }
  for (const [rel, target] of Object.entries(links)) {
    yield* parent(rel);
    yield* fs.symlink(target, path.join(root, rel));
  }
  const read = (rel: string) => fs.readFileString(path.join(root, rel));
  const isLink = (rel: string) =>
    Effect.map(Effect.exit(fs.readLink(path.join(root, rel))), (exit) => exit._tag === "Success");
  return { root, at: (rel: string) => path.join(root, rel), read, isLink, exists: fs.exists };
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
      docs: {
        type: "sse",
        url: "https://docs.example.com/mcp",
        headers: { Authorization: "Bearer ${DOCS_TOKEN}" },
      },
    },
  }),
};

describe("ContextPackService", () => {
  it.effect("round-trips claude to codex to cursor without copying env values", () =>
    Effect.gen(function* () {
      const service = yield* ContextPackService.ContextPackService;
      const dir = yield* fixture(claudeProject);

      expect(yield* service.export(dir.at("project"), dir.at("pack"))).toEqual({
        instructions: true,
        skills: 1,
        servers: 2,
      });
      const manifest = JSON.parse(yield* dir.read("pack/pack.json"));
      expect(manifest).toMatchObject({
        version: 1,
        name: "project",
        skills: ["deploy"],
      });
      expect(yield* dir.read("pack/instructions.md")).toContain("Run the tests.");
      expect(yield* dir.read("pack/skills/deploy/scripts/run.sh")).toBe("echo deploy\n");
      expect(JSON.parse(yield* dir.read("pack/mcp.json"))).toEqual({
        servers: {
          github: { command: "npx", args: ["-y", "@github/mcp"], env: ["GITHUB_TOKEN"] },
          docs: {
            url: "https://docs.example.com/mcp",
            transport: "sse",
            bearerTokenEnv: "DOCS_TOKEN",
          },
        },
      });

      yield* service.import(dir.at("pack"), dir.at("claude"), "claude", false);
      expect(JSON.parse(yield* dir.read("claude/.mcp.json"))).toEqual({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@github/mcp"],
            env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          },
          docs: {
            type: "sse",
            url: "https://docs.example.com/mcp",
            headers: { Authorization: "Bearer ${DOCS_TOKEN}" },
          },
        },
      });

      yield* runCli(["import", dir.at("pack"), dir.at("codex"), "--harness", "codex"]);
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
          '# transport = "sse"',
          'bearer_token_env_var = "DOCS_TOKEN"',
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
          docs: {
            type: "sse",
            url: "https://docs.example.com/mcp",
            headers: { Authorization: "Bearer ${env:DOCS_TOKEN}" },
          },
        },
      });

      // The SSE marker survives each harness, so a later Claude import does not downgrade it.
      yield* service.export(dir.at("cursor"), dir.at("pack3"));
      yield* service.import(dir.at("pack3"), dir.at("opencode"), "opencode", false);
      yield* service.export(dir.at("opencode"), dir.at("pack4"));
      yield* service.import(dir.at("pack4"), dir.at("claude2"), "claude", false);
      for (const pack of ["pack2", "pack3", "pack4"]) {
        expect(JSON.parse(yield* dir.read(`${pack}/mcp.json`)).servers.docs).toEqual({
          url: "https://docs.example.com/mcp",
          transport: "sse",
          bearerTokenEnv: "DOCS_TOKEN",
        });
      }
      expect(JSON.parse(yield* dir.read("claude2/.mcp.json")).mcpServers.docs.type).toBe("sse");

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
          "# profiles",
          "[profiles.fast]",
          'model = "mini"',
        ].join("\n"),
        "opencode/opencode.json": JSON.stringify({
          theme: "dark",
          mcp: { mine: { type: "local" } },
        }),
        "sync/CLAUDE.md": "@AGENTS.md\nClaude only.\n",
        "sync/AGENTS.md": "# Rules\nUse pnpm.\n",
        "sync-opencode/CLAUDE.md": "@AGENTS.md\nClaude only.\n",
        "sync-opencode/AGENTS.md": "# Rules\nUse pnpm.\n",
        "sync-cursor/.cursor/rules/style.mdc": "---\nalwaysApply: true\n---\nBe concise.\n",
        "sync-cursor-replace/.cursor/rules/style.mdc": "---\nalwaysApply: true\n---\nBe concise.\n",
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
      expect(replaced).toContain("# profiles\n[profiles.fast]");
      expect(replaced).not.toContain("[mcp_servers.local");

      yield* service.import(dir.at("pack"), dir.at("codex"), "codex", true);
      yield* service.export(dir.at("codex"), dir.at("pack2"));
      expect(yield* dir.read("pack2/instructions.md")).not.toContain("context-pack:");

      for (const [harness, file] of [
        ["claude", "CLAUDE.md"],
        ["codex", "AGENTS.md"],
        ["opencode", "AGENTS.md"],
      ] as const) {
        yield* service.import(dir.at("pack"), dir.at(`fresh-${harness}`), harness, true);
        yield* service.import(dir.at("pack"), dir.at(`fresh-${harness}`), harness, true);
        const text = yield* dir.read(`fresh-${harness}/${file}`);
        expect(text.match(/Run the tests\./g)).toHaveLength(1);
        expect(text.match(/context-pack:begin/g)).toHaveLength(1);
      }

      // Syncing a project in place reaches a fixed point; markdown harnesses need merge for it.
      const rules = ".cursor/rules";
      for (const [project, harness, merge, phrase, files] of [
        ["sync", "codex", true, /Use pnpm\./g, ["AGENTS.md"]],
        ["sync-opencode", "opencode", true, /Use pnpm\./g, ["AGENTS.md"]],
        [
          "sync-cursor",
          "cursor",
          true,
          /Be concise\./g,
          [`${rules}/context-pack.mdc`, `${rules}/style.mdc`],
        ],
        [
          "sync-cursor-replace",
          "cursor",
          false,
          /Be concise\./g,
          [`${rules}/context-pack.mdc`, `${rules}/style.mdc`],
        ],
      ] as const) {
        const pack = `${project}-pack`;
        const snapshots: Array<string> = [];
        for (let cycle = 0; cycle < 3; cycle++) {
          yield* service.export(dir.at(project), dir.at(pack));
          yield* service.import(dir.at(pack), dir.at(project), harness, merge);
          const paths = [`${pack}/pack.json`, `${pack}/instructions.md`];
          paths.push(...files.map((file) => `${project}/${file}`));
          snapshots.push((yield* Effect.forEach(paths, dir.read)).join("\0"));
        }
        expect(snapshots[2]).toBe(snapshots[1]);
        expect((yield* dir.read(`${pack}/instructions.md`)).match(phrase)).toHaveLength(1);
      }
      for (const project of ["sync", "sync-opencode"]) {
        expect((yield* dir.read(`${project}/AGENTS.md`)).match(/Use pnpm\./g)).toHaveLength(2);
      }
      for (const project of ["sync-cursor", "sync-cursor-replace"]) {
        expect(yield* dir.read(`${project}/${rules}/style.mdc`)).toContain("Be concise.");
      }
      expect(yield* dir.read(`sync-cursor/${rules}/context-pack.mdc`)).toContain(
        "context-pack:begin",
      );
      const packRule = yield* dir.read(`sync-cursor-replace/${rules}/context-pack.mdc`);
      expect(packRule).not.toContain("context-pack:begin");
      expect(packRule.endsWith("\nBe concise.\n")).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("exports every harness's MCP config with env names only", () =>
    Effect.gen(function* () {
      const service = yield* ContextPackService.ContextPackService;
      const dir = yield* fixture({
        "codex/AGENTS.md": "Codex rules\n",
        "codex/.codex/config.toml": [
          "[mcp_servers.inline]",
          "command = 'npx'",
          'env = { INLINE_KEY = "sk-inline-secret" }',
          "",
          "[mcp_servers.table]",
          'command = "table-mcp"',
          "args = [",
          '  "-y",',
          "]",
          "",
          "[mcp_servers.table.env]",
          'TABLE_KEY = "sk-table-secret"',
          "",
          "[mcp_servers.remote]",
          'url = "https://r.example/mcp"',
          'bearer_token_env_var = "REMOTE_TOKEN"',
          // Hand-edited spelling of the marker export writes as `# transport = "sse"`.
          "  # transport = 'sse'",
        ].join("\n"),
        "opencode/AGENTS.md": "OpenCode rules\n",
        "opencode/.opencode/skills/greet/SKILL.md": "Say hi.\n",
        "opencode/opencode.json": JSON.stringify({
          mcp: {
            local: {
              type: "local",
              command: ["oc-mcp", "--stdio"],
              environment: { OC_KEY: "sk-opencode-secret" },
            },
            remote: {
              type: "remote",
              url: "https://oc.example/mcp",
              headers: { Authorization: "Bearer sk-header-secret" },
            },
          },
        }),
        "cursor/.cursor/rules/a.mdc": "---\nalwaysApply: true\n---\nAlways.\n",
        "cursor/.cursor/rules/b.mdc": "---\nglobs: src/**\nalwaysApply: false\n---\nScoped.\n",
        "cursor/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            local: { command: "cur-mcp", env: { CURSOR_KEY: "sk-cursor-secret" } },
            remote: { url: "https://c.example/mcp", headers: { "X-Api-Key": "sk-cursor-hdr" } },
          },
        }),
        // Claude Code leaves this behind wherever a permission was approved.
        "mixed/.claude/settings.local.json": "{}",
        "mixed/AGENTS.md": "real rules\n",
        "mixed/opencode.json": JSON.stringify({
          mcp: { oc: { type: "remote", url: "https://o" } },
        }),
        "mixed/.codex/config.toml": '[mcp_servers.cx]\ncommand = "cx"\n',
        "empty/.claude/settings.local.json": "{}",
        "other/README.md": "Not a pack.\n",
      });

      const cases = [
        {
          project: "codex",
          instructions: "Codex rules",
          servers: {
            inline: { command: "npx", env: ["INLINE_KEY"] },
            table: { command: "table-mcp", env: ["TABLE_KEY"] },
            remote: {
              url: "https://r.example/mcp",
              bearerTokenEnv: "REMOTE_TOKEN",
              transport: "sse",
            },
          },
        },
        {
          project: "opencode",
          instructions: "OpenCode rules",
          servers: {
            local: { command: "oc-mcp", args: ["--stdio"], env: ["OC_KEY"] },
            remote: { url: "https://oc.example/mcp" },
          },
        },
        {
          project: "cursor",
          instructions: "Always.\n\nApplies to files matching src/**:\n\nScoped.",
          servers: {
            local: { command: "cur-mcp", env: ["CURSOR_KEY"] },
            remote: { url: "https://c.example/mcp" },
          },
        },
        {
          project: "mixed",
          instructions: "real rules",
          servers: { oc: { url: "https://o" }, cx: { command: "cx" } },
        },
      ];
      for (const { project, instructions, servers } of cases) {
        const pack = `pack-${project}`;
        yield* service.export(dir.at(project), dir.at(pack));
        expect((yield* dir.read(`${pack}/instructions.md`)).trim()).toBe(instructions);
        const mcp = yield* dir.read(`${pack}/mcp.json`);
        expect(JSON.parse(mcp)).toEqual({ servers });
        expect(mcp).not.toContain("sk-");
      }
      expect(yield* dir.read("pack-opencode/skills/greet/SKILL.md")).toBe("Say hi.\n");

      const empty = yield* Effect.exit(runCli(["export", dir.at("empty"), "--out", dir.at("p")]));
      expect(Exit.isFailure(empty)).toBe(true);
      expect(yield* dir.exists(dir.at("p"))).toBe(false);
      const notPack = yield* Effect.exit(
        runCli(["export", dir.at("codex"), "--out", dir.at("other")]),
      );
      expect(Exit.isFailure(notPack)).toBe(true);
      expect(yield* dir.exists(dir.at("other/pack.json"))).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("copies symlinked skills as files and never reads outside the pack", () =>
    Effect.gen(function* () {
      const service = yield* ContextPackService.ContextPackService;
      const dir = yield* fixture(
        {
          "outside-secret.md": "PRIVATE_KEY_MATERIAL\n",
          "project/CLAUDE.md": "Rules\n@../outside-secret.md\n",
          "project/.cursor/mcp.json": '{"mcpServers":{"db":{"command":"db-mcp"}}}',
          "project/.claude/skills/review/SKILL.md": "Claude review.\n",
          "project/.agents/skills/review/SKILL.md": "Codex review.\n",
          "project/.agents/skills/review/scripts/run.sh": "echo review\n",
          "project/.env": "TOKEN=sk-dotenv\n",
          "project/.agents/skills/lint/SKILL.md": "Lint it.\n",
          "project/.claude/skills/outer/SKILL.md": "Outer.\n",
          "project/tools/skills/outer/inner/SKILL.md": "Inner.\n",
          "outside-skill/SKILL.md": "Outside.\n",
          "private-skill/SKILL.md": "Private.\n",
          "private-skill/key.pem": "PRIVATE_KEY_MATERIAL\n",
          "out-linked/pack.json": "{}",
          "keep/.claude/skills/lint/notes.md": "Local notes.\n",
          "keep-review/SKILL.md": "Kept review.\n",
          "shared/.agents/skills/lint/scripts/custom.sh": "echo custom\n",
        },
        {
          "project/.claude/skills/lint": "../../.agents/skills/lint",
          "project/.claude/skills/ext": "../../../outside-skill",
          "project/.claude/skills/inner": "../../tools/skills/outer/inner",
          "project/.agents/skills/lint/creds": "../../../.env",
          "project/.agents/skills/lint/self": ".",
          alias: "project/.claude",
          "skill-link": "project/.agents/skills/lint",
          "out-linked/skills": "../project/.agents/skills",
          "linked/.claude": "../pack",
          "cursor-alias": "project/.cursor",
          "keep/.claude/skills/review": "../../../keep-review",
          "shared/.claude/skills": "../.agents/skills",
        },
      );
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        dir.at("project/CLAUDE.md"),
        `Rules\n@../outside-secret.md\n@${dir.at("outside-secret.md")}\n`,
      );
      yield* service.export(dir.at("project"), dir.at("pack"));
      const instructions = yield* dir.read("pack/instructions.md");
      expect(instructions.startsWith("Rules\n@../outside-secret.md\n")).toBe(true);
      expect(instructions).not.toContain(dir.root);
      expect(instructions).not.toContain("PRIVATE_KEY_MATERIAL");
      expect(yield* dir.isLink("pack/skills/lint")).toBe(false);
      expect(yield* dir.read("pack/skills/lint/SKILL.md")).toBe("Lint it.\n");
      expect(yield* dir.exists(dir.at("pack/skills/lint/creds"))).toBe(false);
      expect(yield* dir.exists(dir.at("pack/skills/lint/self"))).toBe(false);
      expect(yield* dir.exists(dir.at("pack/skills/ext"))).toBe(false);

      const outs = [
        "project/.claude",
        "project/.agents",
        "project/.agents/skills/lint/o",
        "project/tools",
        "project/.cursor",
        "alias",
        "skill-link/new/deeper",
        "out-linked",
        "cursor-alias",
      ];
      for (const out of outs) {
        const overlap = yield* Effect.flip(service.export(dir.at("project"), dir.at(out)));
        expect(overlap._tag).toBe("ContextPackOverlapError");
        expect(yield* dir.exists(dir.at(`${out}/instructions.md`))).toBe(false);
      }
      expect(yield* dir.read("project/.agents/skills/lint/SKILL.md")).toBe("Lint it.\n");
      expect(yield* dir.read("project/tools/skills/outer/inner/SKILL.md")).toBe("Inner.\n");
      expect(yield* dir.read("project/.agents/skills/review/scripts/run.sh")).toBe("echo review\n");
      expect(yield* dir.read("project/.cursor/mcp.json")).toBe(
        '{"mcpServers":{"db":{"command":"db-mcp"}}}',
      );
      const cli = yield* Effect.exit(
        runCli(["export", dir.at("project"), "--out", dir.at("project/.cursor")]),
      );
      expect(Exit.isFailure(cli)).toBe(true);
      yield* service.export(dir.at("project"), dir.at("p2/.agents"));
      const overlap = yield* Effect.flip(
        service.import(dir.at("p2/.agents"), dir.at("p2"), "codex", false),
      );
      expect(overlap._tag).toBe("ContextPackOverlapError");
      expect(yield* dir.read("p2/.agents/skills/lint/SKILL.md")).toBe("Lint it.\n");
      expect(yield* dir.exists(dir.at("p2/AGENTS.md"))).toBe(false);
      const nested = yield* Effect.flip(
        service.import(dir.at("pack"), dir.at("pack/project"), "codex", false),
      );
      expect(nested._tag).toBe("ContextPackOverlapError");
      const linked = yield* Effect.flip(
        service.import(dir.at("pack"), dir.at("linked"), "claude", false),
      );
      expect(linked._tag).toBe("ContextPackOverlapError");
      expect(yield* dir.read("pack/skills/lint/SKILL.md")).toBe("Lint it.\n");
      expect(yield* dir.exists(dir.at("linked/CLAUDE.md"))).toBe(false);

      for (let run = 0; run < 2; run++) {
        yield* service.import(dir.at("pack"), dir.at("target"), "claude", false);
      }
      expect(yield* dir.isLink("target/.claude/skills/lint")).toBe(false);
      expect(yield* dir.read("target/.claude/skills/lint/SKILL.md")).toBe("Lint it.\n");
      for (const merge of [false, true]) {
        yield* service.import(dir.at("pack"), dir.at("keep"), "claude", merge);
        yield* service.import(dir.at("pack"), dir.at("shared"), "claude", merge);
      }
      expect(yield* dir.read("keep/.claude/skills/lint/SKILL.md")).toBe("Lint it.\n");
      expect(yield* dir.read("keep/.claude/skills/lint/notes.md")).toBe("Local notes.\n");
      expect(yield* dir.isLink("keep/.claude/skills/review")).toBe(false);
      expect(yield* dir.read("keep-review/SKILL.md")).toBe("Kept review.\n");
      expect(yield* dir.read("shared/.agents/skills/lint/SKILL.md")).toBe("Lint it.\n");
      expect(yield* dir.read("shared/.agents/skills/lint/scripts/custom.sh")).toBe("echo custom\n");

      const manifest = JSON.parse(yield* dir.read("pack/pack.json"));
      yield* fs.symlink("../../private-skill", dir.at("pack/skills/evil"));
      yield* fs.writeFileString(
        dir.at("pack/pack.json"),
        JSON.stringify({ ...manifest, skills: [...manifest.skills, "evil"] }),
      );
      yield* service.import(dir.at("pack"), dir.at("victim"), "claude", false);
      expect(yield* dir.read("victim/.claude/skills/lint/SKILL.md")).toBe("Lint it.\n");
      expect(yield* dir.exists(dir.at("victim/.claude/skills/evil"))).toBe(false);

      yield* fs.writeFileString(
        dir.at("pack/pack.json"),
        JSON.stringify({ ...manifest, instructions: "../outside-secret.md" }),
      );
      yield* fs.writeFileString(
        dir.at("pack/mcp.json"),
        JSON.stringify({ servers: { remote: { url: "https://r.example", env: ["KEY"] } } }),
      );
      yield* service.import(dir.at("pack"), dir.at("codex"), "codex", false);
      expect(yield* dir.read("codex/AGENTS.md")).toBe(instructions);
      expect(yield* dir.read("codex/.codex/config.toml")).not.toContain("env_vars");

      yield* fs.remove(dir.at("pack/instructions.md"));
      yield* fs.symlink("../outside-secret.md", dir.at("pack/instructions.md"));
      const error = yield* Effect.flip(
        service.import(dir.at("pack"), dir.at("leak"), "codex", false),
      );
      expect(error._tag).toBe("ContextPackPathError");
      expect(error.message).not.toContain("run the command again");
      expect(yield* dir.exists(dir.at("leak"))).toBe(false);

      yield* fs.writeFileString(
        dir.at("pack/pack.json"),
        JSON.stringify({ ...manifest, skills: ["../lint"] }),
      );
      const bad = yield* Effect.flip(
        service.import(dir.at("pack"), dir.at("leak"), "codex", false),
      );
      expect(bad._tag).toBe("ContextPackFormatError");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
  it.effect("refuses an import a link in the target would carry outside the project", () =>
    Effect.gen(function* () {
      const service = yield* ContextPackService.ContextPackService;
      const dir = yield* fixture(
        {
          ...claudeProject,
          "dotfiles/deploy.md": "MY OWN SKILL\n",
          "dotfiles/scripts/run.sh": "echo mine\n",
          "dotfiles/CLAUDE.md": "my own instructions\n",
          "dotfiles/mcp.json": "{}\n",
          "nested-file/.claude/skills/deploy/notes.md": "keep\n",
          "nested-dir/.claude/skills/deploy/notes.md": "keep\n",
          "new-dir/.claude/skills/deploy/notes.md": "keep\n",
          "dangling/.claude/skills/deploy/notes.md": "keep\n",
          "chain-skill/.claude/skills/deploy/notes.md": "keep\n",
          "inside-chain/inner/keep.txt": "keep\n",
          "absolute/.claude/settings.local.json": "{}",
        },
        {
          // A file and a directory linked out of a same-name skill: `cp -r` would write through both.
          "nested-file/.claude/skills/deploy/SKILL.md": "../../../../dotfiles/deploy.md",
          "nested-dir/.claude/skills/deploy/scripts": "../../../../dotfiles/scripts",
          "new-dir/.claude/skills/deploy/scripts": "../../../../dotfiles/new-scripts",
          // A link the project owns, so removing it to make room for a skill reaches outside too.
          "dotfiles/deploy": "deploy.md",
          // A link with nothing at the end of it still names a path to create outside the project.
          "dangling/.claude/skills/deploy/SKILL.md": "../../../../dotfiles/missing.md",
          // A dangling link at the end of a chain names the same outside path one hop further away.
          "chain-file/CLAUDE.md": "hop2",
          "chain-file/hop2": "../dotfiles/missing-chain.md",
          "chain-mcp/.mcp.json": "hop2",
          "chain-mcp/hop2": "../dotfiles/missing-chain.json",
          "chain-skill/.claude/skills/deploy/SKILL.md": "hop2",
          "chain-skill/.claude/skills/deploy/hop2": "../../../../dotfiles/missing-chain.md",
          "chain3/CLAUDE.md": "h1",
          "chain3/h1": "h2",
          "chain3/h2": "../dotfiles/missing-chain.md",
          // A cycle names no path at all, so it is refused rather than followed.
          "cycle/.claude/skills": "a",
          "cycle/.claude/a": "b",
          "cycle/.claude/b": "a",
          // A chain that stays inside the project is still written through.
          "inside-chain/CLAUDE.md": "hop2",
          "inside-chain/hop2": "inner/CLAUDE.md",
          "skills-dir/.claude/skills": "../../dotfiles",
          "dotdot/.claude/skills": "../../project/../dotfiles",
          "instructions/CLAUDE.md": "../dotfiles/CLAUDE.md",
          "mcp/.mcp.json": "../dotfiles/mcp.json",
          // The pack itself is the target an import must not rewrite.
          "into-pack/CLAUDE.md": "../pack/instructions.md",
          "into-pack/.mcp.json": "../pack/mcp.json",
        },
      );
      const fs = yield* FileSystem.FileSystem;
      yield* fs.symlink(dir.at("dotfiles"), dir.at("absolute/.claude/skills"));
      yield* service.export(dir.at("project"), dir.at("pack"));
      const packed = yield* dir.read("pack/mcp.json");

      for (const merge of [false, true]) {
        for (const target of [
          "nested-file",
          "nested-dir",
          "new-dir",
          "dangling",
          "chain-file",
          "chain-mcp",
          "chain-skill",
          "chain3",
          "cycle",
          "skills-dir",
          "dotdot",
          "absolute",
          "instructions",
          "mcp",
          "into-pack",
        ]) {
          const error = yield* Effect.flip(
            service.import(dir.at("pack"), dir.at(target), "claude", merge),
          );
          expect([target, error._tag]).toEqual([target, "ContextPackPathError"]);
          if (target === "instructions") {
            const root = yield* fs.realPath(dir.at(target));
            expect(error.message).toContain(
              `Copy what ${root}/CLAUDE.md links to into ${root}, or remove the link, then run the command again.`,
            );
          }
        }
      }
      expect(yield* dir.read("dotfiles/deploy.md")).toBe("MY OWN SKILL\n");
      expect(yield* dir.read("dotfiles/scripts/run.sh")).toBe("echo mine\n");
      expect(yield* dir.read("dotfiles/CLAUDE.md")).toBe("my own instructions\n");
      expect(yield* dir.read("dotfiles/mcp.json")).toBe("{}\n");
      expect(yield* dir.exists(dir.at("dotfiles/missing.md"))).toBe(false);
      expect(yield* dir.exists(dir.at("dotfiles/missing-chain.md"))).toBe(false);
      expect(yield* dir.exists(dir.at("dotfiles/missing-chain.json"))).toBe(false);
      expect(yield* dir.exists(dir.at("dotfiles/new-scripts"))).toBe(false);
      expect(yield* dir.isLink("dotfiles/deploy")).toBe(true);
      expect(yield* dir.read("pack/instructions.md")).toContain("Run the tests.");
      expect(yield* dir.read("pack/mcp.json")).toBe(packed);

      for (const merge of [false, true]) {
        yield* service.import(dir.at("pack"), dir.at("inside-chain"), "claude", merge);
      }
      expect(yield* dir.read("inside-chain/inner/CLAUDE.md")).toContain("Run the tests.");

      // A skill name that escapes the pack by shape is refused by the manifest itself.
      const manifest = JSON.parse(yield* dir.read("pack/pack.json"));
      for (const name of ["..", "../deploy", "/abs/deploy", "sub/deploy"]) {
        yield* fs.writeFileString(
          dir.at("pack/pack.json"),
          JSON.stringify({ ...manifest, skills: [name] }),
        );
        const bad = yield* Effect.flip(
          service.import(dir.at("pack"), dir.at("by-name"), "claude", false),
        );
        expect([name, bad._tag]).toEqual([name, "ContextPackFormatError"]);
      }
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
