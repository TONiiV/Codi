import { describe, expect, it, vi } from "vite-plus/test";
import i18n from "i18next";

import { applyLanguage } from "./index";

vi.mock("./locales/zh-CN.json", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

describe("applyLanguage when the locale chunk fails to load", () => {
  it("resolves and keeps the current language", async () => {
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    try {
      await expect(applyLanguage("zh-CN")).resolves.toBeUndefined();
      expect(i18n.language).toBe("en");
      expect(document.documentElement.lang).toBe("en");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
