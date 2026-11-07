import {
  AuthTelescopeAdminScope,
  EnvironmentId,
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
  budgetUsageText,
  createTelescopeGovernanceAtoms,
  governanceRows,
  killSwitchState,
  parseCallLimit,
} from "./governance.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);

const workspaceId = Telescope.WorkspaceId.make("ws");
const agentId = Telescope.AgentId.make("agent");
const budget = (fields: Partial<Telescope.Budget>): Telescope.Budget => ({
  workspaceId,
  scope: "agent",
  scopeId: agentId,
  usedTokens: 0,
  usedUsd: 0,
  usedCalls: 0,
  paused: false,
  ...fields,
});

describe("telescope budget text", () => {
  it.each([
    ["no budget row", undefined, "不限次数，设上限后开始计数"],
    ["no limit", budget({ usedCalls: 3 }), "已用 3 次调用，不限次数"],
    ["under the limit", budget({ usedCalls: 3, limitCalls: 10 }), "已用 3 / 10 次调用"],
    ["spent", budget({ usedCalls: 10, limitCalls: 10 }), "已用 10 / 10 次调用，已用完"],
    ["a zero limit stops at once", budget({ limitCalls: 0 }), "已用 0 / 0 次调用，已用完"],
  ] as const)("%s", (_name, value, expected) => {
    expect(budgetUsageText(value)).toBe(expected);
  });

  it.each([
    ["", { limitCalls: null }],
    ["  ", { limitCalls: null }],
    ["0", { limitCalls: 0 }],
    [" 25 ", { limitCalls: 25 }],
    ["-1", null],
    ["1.5", null],
    ["1e3", null],
    ["abc", null],
    ["99999999999999999999", null],
  ] as const)("parses the call limit %j", (text, expected) => {
    expect(parseCallLimit(text)).toEqual(expected);
  });

  it("reads an agent with no stop on record as running", () => {
    const stop = {
      workspaceId,
      agentId,
      state: "paused" as const,
      by: "owner",
      at: "2026-11-07T00:00:00.000Z",
    };
    expect(killSwitchState({ budgets: [], killSwitches: [] }, agentId)).toBe("running");
    expect(killSwitchState({ budgets: [], killSwitches: [stop] }, agentId)).toBe("paused");
  });
});

describe("telescope governance rows", () => {
  const member = (subjectId: string, displayName: string, revoked = false): Telescope.Member => ({
    workspaceId,
    subjectId,
    displayName,
    role: "member",
    joinedAt: "2026-11-07T00:00:00.000Z",
    ...(revoked ? { revokedAt: "2026-11-07T01:00:00.000Z" } : {}),
  });
  const agent = (
    id: string,
    name: string,
    ownerSubjectId: string | null,
  ): Telescope.GovernanceAgent => ({
    id: Telescope.AgentId.make(id),
    name,
    kind: "chief_agent",
    ownerSubjectId,
  });
  const page = {
    company: { id: workspaceId, title: "整个公司" },
    projects: [
      { value: "p2", label: "Beta" },
      { value: "p1", label: "Alpha" },
    ],
    members: [member("owner", "Theo"), member("max", "Max"), member("gone", "Gone", true)],
    self: "owner",
    fallbackAgents: [agent("mine", "Mine", "owner"), agent("co", "Company", null)],
  };
  const rows = (state: Partial<typeof Telescope.GovernanceState.Type>, overrides = {}) =>
    governanceRows({ budgets: [], killSwitches: [], ...state }, { ...page, ...overrides }).map(
      (row) => `${row.scope}:${row.scopeId}:${row.title}`,
    );

  it("lists company, bound projects, current members, then every agent the server sends", () => {
    expect(
      rows(
        {
          agents: [
            agent("co", "Company", null),
            agent("max-chief", "Chief Agent", "max"),
            agent("gone-chief", "Old Agent", "gone"),
            agent("stray", "Stray", "unknown-subject"),
          ],
        },
        { projects: [...page.projects, { value: "p1", label: "Alpha (laptop)" }] },
      ),
    ).toEqual([
      "company:ws:整个公司",
      "project:p2:Beta",
      "project:p1:Alpha",
      "person:owner:Theo",
      "person:max:Max",
      "agent:co:Company",
      "agent:max-chief:Max 的 Chief Agent",
      "agent:gone-chief:Gone 的 Old Agent",
      "agent:stray:unknown-subject 的 Stray",
    ]);
  });

  it("falls back to the caller's own and company agents, once each, on an older server", () => {
    const fallbackAgents = [...page.fallbackAgents, agent("co", "Company", null)];
    expect(rows({}, { fallbackAgents }).filter((row) => row.startsWith("agent:"))).toEqual([
      "agent:mine:Mine",
      "agent:co:Company",
    ]);
  });
});

describe("telescope governance atoms", () => {
  const env = EnvironmentId.make("local");
  const setup = Effect.fn(function* () {
    let budgets: ReadonlyArray<Telescope.Budget> = [];
    const get = vi.fn(() => Effect.sync(() => ({ budgets, killSwitches: [] })));
    const client = {
      [Telescope.WS_METHODS.governanceGet]: get,
      [Telescope.WS_METHODS.budgetSet]: ({
        limitCalls,
        ...input
      }: typeof Telescope.BudgetSetInput.Type) =>
        Effect.sync(() => {
          const saved = budget({
            ...input,
            scope: input.scope,
            ...(typeof limitCalls === "number" ? { limitCalls } : {}),
          });
          budgets = [saved];
          return saved;
        }),
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
    const governance = createTelescopeGovernanceAtoms(runtime);
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
    const state = governance.state({ environmentId: env, input: { workspaceId } });
    registry.mount(state);
    const read = AtomRegistry.getResult(registry, state, { suspendOnWaiting: true });
    return { governance, registry, get, read };
  });

  it.effect("re-read the budgets after an admin sets a limit", () =>
    Effect.gen(function* () {
      const { governance, registry, get, read } = yield* setup();
      expect(yield* read).toEqual({ budgets: [], killSwitches: [] });
      const input = { workspaceId, scope: "company" as const, scopeId: workspaceId, limitCalls: 5 };
      const result = yield* Effect.promise(() =>
        governance.setBudget.run(registry, { environmentId: env, input }),
      );
      expect(result._tag).toBe("Success");
      expect((yield* read).budgets).toMatchObject([{ scope: "company", limitCalls: 5 }]);
      expect(get).toHaveBeenCalledTimes(2);
    }),
  );
});
