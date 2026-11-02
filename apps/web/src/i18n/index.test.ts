import { describe, expect, it } from "vite-plus/test";

import { resolveLanguage } from "./index";

describe("resolveLanguage", () => {
  it.each([
    ["system", "zh", "zh-CN"],
    ["system", "zh-TW", "zh-CN"],
    ["system", "zh-Hans-CN", "zh-CN"],
    ["system", "ZH-hk", "zh-CN"],
    ["system", "en-US", "en"],
    ["system", "ja-JP", "en"],
    ["system", "", "en"],
    ["en", "zh-CN", "en"],
    ["zh-CN", "en-US", "zh-CN"],
  ] as const)("%s with system %j resolves to %s", (preference, system, expected) => {
    expect(resolveLanguage(preference, system)).toBe(expected);
  });
});
