import { ProjectId, ProviderInstanceId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupRoutingRules,
  parseRoutingRuleDraft,
  ROUTING_SKIP_REASON_TEXT,
  taskTypeProblem,
  type RoutingRuleDraft,
} from "./routing.ts";

const workspaceId = Telescope.WorkspaceId.make("ws");
const project = ProjectId.make("project-api");
const harness = ProviderInstanceId.make("codex");
let next = 0;
const rule = (fields: Partial<Telescope.RoutingRule>): Telescope.RoutingRule => ({
  id: Telescope.RoutingRuleId.make(`rule-${next++}`),
  workspaceId,
  taskType: "review",
  harness,
  model: "small",
  priority: 0,
  ...fields,
});

const projectExact = rule({ projectId: project });
const projectAny = rule({ projectId: project, taskType: "*" });
const allExact = rule({});
const allAny = rule({ taskType: "*" });

const order = (rules: ReadonlyArray<Telescope.RoutingRule>) =>
  groupRoutingRules(rules).map((entry) => [entry.label, entry.rules.map((item) => item.id)]);

describe("groupRoutingRules", () => {
  it.each([
    [
      "groups in the resolver's order (D58), whatever the list order",
      [allAny, allExact, projectAny, projectExact],
      [
        ["项目 + 精确类型", [projectExact.id]],
        ["项目 + 任意类型", [projectAny.id]],
        ["全部项目 + 精确类型", [allExact.id]],
        ["全部项目 + 任意类型", [allAny.id]],
      ],
    ],
    [
      "a project's any type comes before every project's exact type",
      [allExact, projectAny],
      [
        ["项目 + 任意类型", [projectAny.id]],
        ["全部项目 + 精确类型", [allExact.id]],
      ],
    ],
    [
      "a higher priority never crosses into an earlier group",
      [rule({ ...allExact, priority: 9 }), projectAny],
      [
        ["项目 + 任意类型", [projectAny.id]],
        ["全部项目 + 精确类型", [allExact.id]],
      ],
    ],
    ["leaves out empty groups", [], []],
  ] as const)("%s", (_name, rules, expected) => {
    expect(order(rules)).toEqual(expected);
  });

  it.each([
    ["higher priority first", [0, 5], [1, 0]],
    ["equal priority keeps creation order", [3, 3], [0, 1]],
    ["equal priority keeps creation order when listed later", [3, 3, 7], [2, 0, 1]],
  ] as const)("within a group: %s", (_name, priorities, expected) => {
    const rules = priorities.map((priority) => rule({ priority }));
    expect(order(rules)).toEqual([
      ["全部项目 + 精确类型", expected.map((index) => rules[index]!.id)],
    ]);
  });
});

describe("taskTypeProblem", () => {
  it.each([
    ["review", null],
    ["  ", "请填写任务类型。"],
    ["t".repeat(64), null],
    ["t".repeat(65), "任务类型最多 64 个字符。"],
  ] as const)("%j", (text, expected) => {
    expect(taskTypeProblem(text)).toBe(expected);
  });
});

describe("routing skip reasons", () => {
  it("names every reason the server sends", () => {
    expect(Object.keys(ROUTING_SKIP_REASON_TEXT).toSorted()).toEqual(
      [...Telescope.RoutingSkipReason.literals].toSorted(),
    );
  });
});

describe("parseRoutingRuleDraft", () => {
  const draft = (fields: Partial<RoutingRuleDraft>): RoutingRuleDraft => ({
    projectId: null,
    taskType: "review",
    harness,
    model: "small",
    priority: "0",
    ...fields,
  });

  it.each([
    ["task type at 64", { taskType: "t".repeat(64) }, { taskType: "t".repeat(64) }],
    ["task type over 64", { taskType: "t".repeat(65) }, "任务类型最多 64 个字符。"],
    ["blank task type means any", { taskType: "  " }, { taskType: "*" }],
    ["* means any", { taskType: "*" }, { taskType: "*" }],
    ["model at 128", { model: "m".repeat(128) }, { model: "m".repeat(128) }],
    ["model over 128", { model: "m".repeat(129) }, "模型最多 128 个字符。"],
    ["blank model", { model: " " }, "请填写模型。"],
    ["no harness", { harness: null }, "请选择 harness。"],
    ["trims", { taskType: " review ", model: " small ", priority: " 4 " }, { priority: 4 }],
    ["negative priority", { priority: "-1" }, "优先级是 0 或更大的整数。"],
    ["fractional priority", { priority: "1.5" }, "优先级是 0 或更大的整数。"],
    ["blank priority", { priority: "" }, "优先级是 0 或更大的整数。"],
    ["huge priority", { priority: "99999999999999999999" }, "优先级是 0 或更大的整数。"],
    ["a project", { projectId: project }, { projectId: project }],
  ] as const)("%s", (_name, fields, expected) => {
    const result = parseRoutingRuleDraft(draft(fields));
    if (typeof expected === "string") expect(result).toEqual({ problem: expected });
    else expect(result).toEqual({ fields: expect.objectContaining(expected) });
  });

  it("leaves projectId out for every project", () => {
    expect(parseRoutingRuleDraft(draft({}))).toEqual({
      fields: { taskType: "review", harness, model: "small", priority: 0 },
    });
  });
});
