import {
  AuthTelescopeMemberScope,
  EnvironmentId,
  Telescope,
  ThreadId,
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
  createTelescopeDelegationAtoms,
  type DelegationSummary,
  needsYou,
  offersCancel,
} from "./delegations.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);

const workspaceId = Telescope.WorkspaceId.make("ws");
const at = (minute: number) => `2026-11-07T10:${String(minute).padStart(2, "0")}:00.000Z`;
const pa = Telescope.AgentId.make("pa");
const chief = Telescope.AgentId.make("chief");

const delegation = (
  id: string,
  state: Telescope.A2ATaskState,
  decisionId?: string,
): DelegationSummary => ({
  id: Telescope.DelegationId.make(id),
  contextId: `ctx-${id}`,
  workspaceId,
  fromAgentId: pa,
  toAgentId: chief,
  hop: "agent",
  threadId: ThreadId.make(`thread-${id}`),
  ...(decisionId === undefined ? {} : { decisionId: Telescope.DecisionId.make(decisionId) }),
  state,
  brief: { goal: "推进夹爪项目", constraints: [], acceptance: [], goalChain: [] },
  artifacts: [],
  createdAt: at(0),
  updatedAt: at(0),
});

const decision = (
  id: string,
  status: Telescope.DecisionStatus,
  minute: number,
): Telescope.Decision => ({
  kind: "decision",
  id: Telescope.DecisionId.make(id),
  workspaceId,
  title: `问题 ${id}`,
  text: "",
  authorId: chief,
  status,
  options: [{ id: "1", label: "A" }],
  createdAt: at(minute),
  updatedAt: at(minute),
  version: 1,
});

const member: Telescope.Member = {
  workspaceId,
  subjectId: "me",
  displayName: "Me",
  role: "member",
  joinedAt: at(0),
};

describe("telescope needs-you", () => {
  it("needs-you lists only proposals whose delegation is INPUT_REQUIRED or AUTH_REQUIRED and not terminal", () => {
    const delegations = [
      delegation("input", "INPUT_REQUIRED", "q-input"),
      delegation("auth", "AUTH_REQUIRED", "q-auth"),
      delegation("answered", "INPUT_REQUIRED", "q-answered"),
      delegation("canceled", "CANCELED", "q-canceled"),
      delegation("failed", "FAILED", "q-failed"),
      delegation("working", "WORKING", "q-working"),
      delegation("no-decision", "INPUT_REQUIRED"),
    ];
    const decisions = [
      decision("q-auth", "proposed", 2),
      decision("q-input", "proposed", 1),
      decision("q-answered", "superseded", 3),
      decision("q-canceled", "proposed", 4),
      decision("q-failed", "proposed", 5),
      decision("q-working", "proposed", 6),
      decision("unrelated", "proposed", 7),
    ];
    expect(
      needsYou(delegations, decisions).map(({ delegation, proposal }) => [
        delegation.id,
        proposal.id,
      ]),
    ).toEqual([
      ["input", "q-input"],
      ["auth", "q-auth"],
    ]);
  });

  it.each([
    { who: "the owner of the sending agent", owner: { pa: "me" }, state: "WORKING", offered: true },
    {
      who: "the owner of the receiving agent",
      owner: { chief: "me" },
      state: "AUTH_REQUIRED",
      offered: true,
    },
    {
      who: "a member who owns neither agent",
      owner: { pa: "bea", chief: "bea" },
      state: "WORKING",
      offered: false,
    },
    {
      who: "a revoked owner",
      owner: { pa: "me" },
      state: "WORKING",
      offered: false,
      revoked: true,
    },
    {
      who: "the owner, once the delegation ended",
      owner: { pa: "me" },
      state: "COMPLETED",
      offered: false,
    },
  ] as const)(
    "cancel is offered only to the owner of an agent in the chain: $who → $offered",
    ({ owner, state, offered, ...rest }) => {
      const agents = [
        { id: pa, ownerSubjectId: "pa" in owner ? owner.pa : "bea" },
        { id: chief, ownerSubjectId: "chief" in owner ? owner.chief : "bea" },
      ];
      const self = "revoked" in rest ? { ...member, revokedAt: at(1) } : member;
      expect(offersCancel(delegation("d", state), agents, self)).toBe(offered);
    },
  );
});

describe("telescope delegation queries", () => {
  it.effect(
    "re-read on a delegation notice, when the decision list changes and after a cancel, not on its first answer",
    () =>
      Effect.gen(function* () {
        const env = EnvironmentId.make("local");
        const list = vi.fn(() => Effect.succeed({ delegations: [] }));
        const client = {
          [Telescope.WS_METHODS.delegationList]: list,
          [Telescope.WS_METHODS.delegationCancel]: () => Effect.succeed({ canceled: [] }),
        };
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
        const board = Atom.make<
          AsyncResult.AsyncResult<typeof Telescope.DecisionListResult.Type, unknown>
        >(AsyncResult.initial());
        const notices = Atom.make(0);
        const delegations = createTelescopeDelegationAtoms(
          runtime,
          () => board,
          () => notices,
        );
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
            scopes: [AuthTelescopeMemberScope],
            permissions: [AuthTelescopeMemberScope],
          }),
        );
        registry.mount(board);
        const query = delegations.list({ environmentId: env, input: { workspaceId, agentId: pa } });
        registry.mount(query);
        const read = () => AtomRegistry.getResult(registry, query, { suspendOnWaiting: true });
        yield* read();
        registry.set(board, AsyncResult.success({ decisions: [] }));
        yield* read();
        expect(list).toHaveBeenCalledTimes(1);

        registry.set(board, AsyncResult.success({ decisions: [decision("q", "proposed", 1)] }));
        yield* read();
        expect(list).toHaveBeenCalledTimes(2);

        const delegationId = Telescope.DelegationId.make("d");
        const canceled = yield* Effect.promise(() =>
          delegations.cancel.run(registry, {
            environmentId: env,
            input: { workspaceId, delegationId },
          }),
        );
        expect(canceled._tag).toBe("Success");
        yield* read();
        expect(list).toHaveBeenCalledTimes(3);

        registry.set(notices, 1);
        yield* read();
        expect(list).toHaveBeenCalledTimes(4);
      }),
  );
});
