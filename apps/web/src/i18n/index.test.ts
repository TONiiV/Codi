import { describe, expect, it, vi } from "vite-plus/test";
import i18n from "i18next";

import { englishT } from "./englishT";
import { applyLanguage, resolveLanguage } from "./index";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

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

describe("i18n initialization", () => {
  it("is ready synchronously and keeps the helper translator English across language changes", () => {
    expect(i18n.isInitialized).toBe(true);
    vi.stubGlobal("document", { documentElement: { lang: "" } });

    try {
      applyLanguage("zh-CN");
      expect(document.documentElement.lang).toBe("zh-CN");
      expect(i18n.t("common.search")).toBe(zhCN.common.search);
      expect(englishT("common.search")).toBe(en.common.search);

      applyLanguage("en");
      expect(document.documentElement.lang).toBe("en");
      expect(i18n.t("common.search")).toBe(en.common.search);
      expect(englishT("common.search")).toBe(en.common.search);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
