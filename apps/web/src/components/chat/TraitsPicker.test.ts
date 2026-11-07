import { createInstance } from "i18next";
import { describe, expect, it } from "vite-plus/test";

import { englishT } from "~/i18n/englishT";
import zhCN from "~/i18n/locales/zh-CN.json";
import { traitText } from "./TraitsPicker";

const zh = createInstance();
void zh.init({ lng: "zh-CN", resources: { "zh-CN": { translation: zhCN } } });

describe("traitText", () => {
  it.each([
    ["High", "高"],
    ["Ultra", "极致"],
    ["Extra High Effort", "超高强度"],
    ["Thinking On", "思考 开"],
    ["High Fast · Context Window", "高 快速 · 上下文窗口"],
    ["Low latency", "Low latency"],
    ["On demand", "On demand"],
    ["Default model", "Default model"],
    ["Max Mode", "Max Mode"],
    ["Web Search On", "Web Search On"],
  ])("translates %s only as whole known phrases", (label, expected) => {
    expect(traitText(label, zh.t)).toBe(expected);
    expect(traitText(label, englishT)).toBe(label);
  });
});
