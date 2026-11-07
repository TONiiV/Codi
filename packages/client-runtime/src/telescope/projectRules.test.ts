import { ProjectId, ProviderInstanceId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  allowlistSummary,
  DEFAULT_PROJECT_RULE_DRAFT,
  isDefaultProjectRule,
  parseProjectRuleDraft,
  projectRuleDraft,
  type ProjectRuleDraft,
} from "./projectRules.ts";

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
