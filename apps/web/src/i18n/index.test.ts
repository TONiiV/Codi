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
  it("starts in English, loads zh-CN on first use, and lets the latest language request win", async () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.hasResourceBundle("zh-CN", "translation")).toBe(false);
    vi.stubGlobal("document", { documentElement: { lang: "" } });

    try {
      await applyLanguage("zh-CN");
      expect(document.documentElement.lang).toBe("zh-CN");
      expect(i18n.t("common.search")).toBe(zhCN.common.search);
      expect(englishT("common.search")).toBe(en.common.search);

      await applyLanguage("en");
      expect(document.documentElement.lang).toBe("en");
      expect(i18n.t("common.search")).toBe(en.common.search);

      i18n.removeResourceBundle("zh-CN", "translation");
      await Promise.all([applyLanguage("zh-CN"), applyLanguage("en")]);
      expect(document.documentElement.lang).toBe("en");
      expect(i18n.language).toBe("en");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
