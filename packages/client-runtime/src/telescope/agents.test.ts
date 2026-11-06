import {
  AuthTelescopeAdminScope,
  EnvironmentId,
  ProjectId,
  Telescope,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { AVAILABLE_CONNECTION_STATE, BearerConnectionTarget } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { cappedPowers, createTelescopeAgentAtoms, ownerCanMergePRs } from "./agents.ts";
import { createTelescopeWorkspaceAtoms } from "./workspaces.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);

const workspaceId = Telescope.WorkspaceId.make("ws");
const app = ProjectId.make("app");
const docs = ProjectId.make("docs");
const member = (role: Telescope.WorkspaceRole): Telescope.Member => ({
  workspaceId,
  subjectId: "me",
  displayName: "Me",
  role,
  joinedAt: "2026-11-06T00:00:00.000Z",
});
const binding = (leadSubjectId?: string, projectId = app): Telescope.ProjectBinding => ({
  workspaceId,
  environmentId: EnvironmentId.make("local"),
  projectId,
  ...(leadSubjectId === undefined ? {} : { leadSubjectId }),
});
const ALL_POWERS: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};

describe("telescope standing power cap", () => {
  it.each([
    { who: "an admin", role: "admin", projectId: undefined, bindings: [], expected: true },
    {
      who: "the agent project lead",
      role: "project_lead",
      projectId: app,
      bindings: [binding("me")],
      expected: true,
    },
    {
      who: "a lead whose project has another lead",
      role: "project_lead",
      projectId: app,
      bindings: [binding("someone-else")],
      expected: false,
    },
    {
      who: "the lead of another project",
      role: "project_lead",
      projectId: app,
      bindings: [binding("someone-else"), binding("me", docs)],
      expected: false,
    },
    {
      who: "a lead with an unbound agent",
      role: "project_lead",
      projectId: undefined,
      bindings: [binding("me")],
      expected: false,
    },
    { who: "a member", role: "member", projectId: app, bindings: [binding()], expected: false },
  ] as const)("$who may merge: $expected", ({ role, projectId, bindings, expected }) => {
    const agent = projectId === undefined ? {} : { projectId };
    expect(ownerCanMergePRs(member(role), agent, bindings)).toBe(expected);
  });

  it("keeps a stored merge right off above the cap and leaves other powers alone", () => {
    expect(cappedPowers(ALL_POWERS, false)).toEqual({ ...ALL_POWERS, mergePRs: false });
    expect(cappedPowers(ALL_POWERS, true)).toEqual(ALL_POWERS);
  });
});

describe("telescope agent queries", () => {
  it("re-read the caller's agents and the bindings after this client binds a project", async () => {
    const env = EnvironmentId.make("local");
    let bindings: ReadonlyArray<Telescope.ProjectBinding> = [];
    const listMine = vi.fn(() => Effect.succeed({ agents: [] }));
    const client = {
      [Telescope.WS_METHODS.agentListMine]: listMine,
      [Telescope.WS_METHODS.projectListBindings]: () => Effect.sync(() => ({ bindings })),
      [Telescope.WS_METHODS.projectBindingSummary]: () => Effect.succeed({ projects: [] }),
      [Telescope.WS_METHODS.projectBind]: (input: Telescope.ProjectBinding) =>
        Effect.sync(() => {
          bindings = [input];
          return input;
        }),
    };
    const program = Effect.gen(function* () {
      const supervisor = {
        target: new BearerConnectionTarget({
          environmentId: env,
          label: "Test",
          connectionId: "t",
        }),
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
      const agents = createTelescopeAgentAtoms(runtime, workspaces.bindingsRevisionAtom);
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
      const scoped = { environmentId: env, input: { workspaceId } };
      const mine = agents.listMine(scoped);
      const bound = agents.bindings(scoped);
      registry.mount(mine);
      registry.mount(bound);
      const read = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
        AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
      expect(yield* read(bound)).toEqual({ bindings: [] });
      yield* read(mine);
      expect(listMine).toHaveBeenCalledTimes(1);

      const input = { workspaceId, environmentId: env, projectId: app, leadSubjectId: "me" };
      const result = yield* Effect.promise(() =>
        workspaces.bind.run(registry, { environmentId: env, input }),
      );
      expect(result._tag).toBe("Success");
      expect(yield* read(bound)).toEqual({ bindings: [input] });
      yield* read(mine);
      expect(listMine).toHaveBeenCalledTimes(2);
    });
    await Effect.runPromise(Effect.scoped(program));
  });
});
