import {
  AuthTelescopeAdminScope,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  Telescope,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { AVAILABLE_CONNECTION_STATE, BearerConnectionTarget } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  allowlistSummary,
  createTelescopeProjectRuleAtoms,
  DEFAULT_PROJECT_RULE_DRAFT,
  isDefaultProjectRule,
  parseProjectRuleDraft,
  projectRuleDraft,
  type ProjectRuleDraft,
} from "./projectRules.ts";
import { createTelescopeAgentAtoms } from "./agents.ts";
import { createTelescopeGovernanceAtoms } from "./governance.ts";
import { createTelescopeRoutingAtoms } from "./routing.ts";
import { createTelescopeWorkspaceAtoms } from "./workspaces.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claude");
const powers = { ...DEFAULT_PROJECT_RULE_DRAFT.powers, mergePRs: false };
const draft = (fields: Partial<ProjectRuleDraft>): ProjectRuleDraft => ({
  ...DEFAULT_PROJECT_RULE_DRAFT,
  ...fields,
});
const rule = (fields: Partial<Telescope.ProjectRule>): Telescope.ProjectRule => ({
  projectId: ProjectId.make("project-api"),
  stored: true,
  powers: DEFAULT_PROJECT_RULE_DRAFT.powers,
  routing: null,
  ...fields,
});

describe("parseProjectRuleDraft", () => {
  it.each([
    ["不限 for both sends no allowlist", draft({ powers }), { powers, routing: null }],
    [
      "a harness set alone",
      draft({ harnesses: [codex, claude, codex] }),
      { powers: DEFAULT_PROJECT_RULE_DRAFT.powers, routing: { harnesses: [codex, claude] } },
    ],
    [
      "models trimmed, deduplicated, blank lines dropped",
      draft({ models: " small \n\nlarge, small，tiny\n" }),
      {
        powers: DEFAULT_PROJECT_RULE_DRAFT.powers,
        routing: { models: ["small", "large", "tiny"] },
      },
    ],
    [
      "both lists",
      draft({ harnesses: [codex], models: "small" }),
      {
        powers: DEFAULT_PROJECT_RULE_DRAFT.powers,
        routing: { harnesses: [codex], models: ["small"] },
      },
    ],
  ])("%s", (_name, input, fields) => {
    expect(parseProjectRuleDraft(input)).toEqual({ fields });
  });

  it.each([
    ["an empty harness set", draft({ harnesses: [] }), "请至少选一个 harness，或选不限。"],
    ["a model list of blanks", draft({ models: " \n, " }), "请至少填一个模型，或选不限。"],
    ["a too-long model", draft({ models: "x".repeat(129) }), "每个模型最多 128 个字符。"],
    [
      "too many models",
      draft({ models: Array.from({ length: 65 }, (_, index) => `m${index}`).join("\n") }),
      "最多填 64 个模型。",
    ],
    [
      "too many harnesses",
      draft({ harnesses: Array.from({ length: 65 }, (_, i) => ProviderInstanceId.make(`h${i}`)) }),
      "最多选 64 个 harness。",
    ],
  ])("refuses %s", (_name, input, problem) => {
    expect(parseProjectRuleDraft(input)).toEqual({ problem });
  });

  it("round-trips a stored rule, reading empty lists as 不限", () => {
    expect(projectRuleDraft(rule({ routing: { harnesses: [], models: ["a", "b"] } }))).toEqual({
      powers: DEFAULT_PROJECT_RULE_DRAFT.powers,
      harnesses: null,
      models: "a\nb",
    });
    expect(
      parseProjectRuleDraft(projectRuleDraft(rule({ routing: { harnesses: [], models: [] } }))),
    ).toEqual({ fields: { powers: DEFAULT_PROJECT_RULE_DRAFT.powers, routing: null } });
  });
});

describe("project rule summary", () => {
  it.each([
    ["no stored rule", rule({ stored: false }), true],
    ["a stored rule that removes nothing", rule({}), true],
    ["empty lists (D110)", rule({ routing: { harnesses: [], models: [] } }), true],
    ["a power taken away", rule({ powers }), false],
    ["a harness list", rule({ routing: { harnesses: [codex] } }), false],
    ["a model list", rule({ routing: { models: ["small"] } }), false],
  ])("%s reads default: %s", (_name, input, expected) => {
    expect(isDefaultProjectRule(input)).toBe(expected);
  });

  const name = (id: ProviderInstanceId) => (id === codex ? "Codex" : id);
  it.each([
    [null, "任意 harness 和模型"],
    [{ harnesses: [], models: [] }, "任意 harness 和模型"],
    [{ harnesses: [codex, claude] }, "Codex、claude · 任意模型"],
    [{ models: ["small", "large"] }, "任意 harness · small、large"],
  ])("summarises %j", (routing, text) => {
    expect(allowlistSummary(routing, name)).toBe(text);
  });
});

describe("project rule atoms", () => {
  const env = EnvironmentId.make("local");
  const workspaceId = Telescope.WorkspaceId.make("ws");
  const setup = Effect.fn(function* () {
    const server = {
      rules: [rule({})],
      role: "admin" as Telescope.WorkspaceRole,
    };
    const refuse = () =>
      Effect.fail(new Telescope.WorkspaceError({ reason: "forbidden", message: "demoted" }));
    const client = {
      [Telescope.WS_METHODS.projectRuleList]: () => Effect.sync(() => ({ rules: server.rules })),
      [Telescope.WS_METHODS.projectRuleSet]: refuse,
      [Telescope.WS_METHODS.routingSet]: refuse,
      [Telescope.WS_METHODS.budgetSet]: refuse,
      [Telescope.WS_METHODS.killSwitchSet]: refuse,
      [Telescope.WS_METHODS.memberSetRole]: refuse,
      [Telescope.WS_METHODS.memberRevoke]: refuse,
      [Telescope.WS_METHODS.memberRestore]: refuse,
      [Telescope.WS_METHODS.routingDelete]: refuse,
      [Telescope.WS_METHODS.agentUpdateCompany]: refuse,
      [Telescope.WS_METHODS.workspaceGet]: () =>
        Effect.sync(() => ({
          workspace: {
            id: workspaceId,
            kind: "personal" as const,
            name: "ws",
            createdAt: "2026-11-07T00:00:00.000Z",
            createdBy: "owner",
          },
          self: {
            workspaceId,
            subjectId: "me",
            displayName: "me",
            role: server.role,
            joinedAt: "2026-11-07T00:00:00.000Z",
          },
        })),
    };
    const supervisor = {
      target: new BearerConnectionTarget({ environmentId: env, label: "Test", connectionId: "t" }),
      session: yield* SubscriptionRef.make(Option.some({ client } as unknown as RpcSession)),
      state: yield* SubscriptionRef.make({
        ...AVAILABLE_CONNECTION_STATE,
        phase: "connected" as const,
      }),
    } as EnvironmentSupervisor["Service"];
    const runtime = Atom.runtime(
      Layer.succeed(EnvironmentRegistry, {
        run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
        followStream: (_id, stream) =>
          Stream.provideService(stream, EnvironmentSupervisor, supervisor),
      } as EnvironmentRegistry["Service"]),
    );
    const workspaces = createTelescopeWorkspaceAtoms(runtime, {
      read: () => null,
      write: () => {},
    });
    const projectRules = createTelescopeProjectRuleAtoms(runtime, workspaces.get);
    const routing = createTelescopeRoutingAtoms(runtime, workspaces.get);
    const governance = createTelescopeGovernanceAtoms(runtime, workspaces.get);
    const agents = createTelescopeAgentAtoms(
      runtime,
      workspaces.bindingsRevisionAtom,
      workspaces.get,
    );
    const at = <I>(input: I) => ({ environmentId: env, input: { workspaceId, ...input } });
    const agentId = Telescope.AgentId.make("agent");
    const projectId = ProjectId.make("project-api");
    const refused: ReadonlyArray<readonly [string, () => Promise<{ readonly _tag: string }>]> = [
      [
        "project rule",
        () => projectRules.set.run(registry, at({ projectId, powers, routing: null })),
      ],
      [
        "routing rule",
        () =>
          routing.set.run(registry, at({ taskType: "*", harness: codex, model: "m", priority: 0 })),
      ],
      [
        "budget",
        () =>
          governance.setBudget.run(
            registry,
            at({ scope: "company" as const, scopeId: workspaceId }),
          ),
      ],
      [
        "kill switch",
        () => governance.setKillSwitch.run(registry, at({ agentId, state: "paused" as const })),
      ],
      [
        "role",
        () => workspaces.setRole.run(registry, at({ subjectId: "x", role: "member" as const })),
      ],
      ["company agent", () => agents.updateCompany.run(registry, at({ agentId }))],
      ["revoke", () => workspaces.revoke.run(registry, at({ subjectId: "x" }))],
      ["restore", () => workspaces.restore.run(registry, at({ subjectId: "x" }))],
      [
        "routing delete",
        () => routing.remove.run(registry, at({ id: Telescope.RoutingRuleId.make("rule") })),
      ],
    ];
    const registry = AtomRegistry.make();
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
    registry.mount(sessions(env));
    registry.set(
      sessions(env),
      AsyncResult.success({
        authenticated: true,
        auth: {
          policy: "remote-reachable",
          bootstrapMethods: [],
          sessionMethods: [],
          sessionCookieName: "t",
        },
        scopes: [AuthTelescopeAdminScope],
        permissions: [AuthTelescopeAdminScope],
      }),
    );
    const target = { environmentId: env, input: { workspaceId } };
    const read = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) => {
      registry.mount(atom);
      return AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
    };
    return { server, workspaces, projectRules, refused, registry, target, read };
  });

  it.effect("opens the editor on the server's current rule, not the page's old copy", () =>
    Effect.gen(function* () {
      const { server, projectRules, registry, target, read } = yield* setup();
      expect((yield* read(projectRules.list(target))).rules).toEqual([rule({})]);
      server.rules = [rule({ powers })];
      const projectId = ProjectId.make("project-api");
      const current = yield* projectRules.current(registry, {
        environmentId: env,
        input: { workspaceId, projectId },
      });
      expect(current).toEqual(rule({ powers }));
    }),
  );

  it.effect("re-reads the caller's role after any admin change refused for permission", () =>
    Effect.gen(function* () {
      const { server, workspaces, refused, registry, target, read } = yield* setup();
      for (const [name, run] of refused) {
        server.role = "admin";
        registry.refresh(workspaces.get(target));
        expect((yield* read(workspaces.get(target))).self.role, name).toBe("admin");
        server.role = "member";
        const result = yield* Effect.promise(run);
        expect(result._tag, name).toBe("Failure");
        expect((yield* read(workspaces.get(target))).self.role, name).toBe("member");
      }
    }),
  );
});
