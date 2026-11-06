import type { AppLanguage } from "@t3tools/contracts/settings";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

type Language = Exclude<AppLanguage, "system">;

export function resolveLanguage(
  preference: AppLanguage,
  systemLanguage = navigator.language,
): Language {
  if (preference !== "system") return preference;
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

// English ships in the main bundle; other locales load on first use.
const loadLocale = {
  "zh-CN": () => import("./locales/zh-CN.json"),
} satisfies Record<Exclude<Language, "en">, () => Promise<{ default: typeof en }>>;

let latestRequest = 0;

export async function applyLanguage(preference: AppLanguage): Promise<void> {
  const language = resolveLanguage(preference);
  const request = ++latestRequest;
  if (language !== "en" && !i18n.hasResourceBundle(language, "translation")) {
    // Offline or a failed chunk load keeps the current language.
    const loaded = await loadLocale[language]().catch(() => null);
    if (loaded === null) return;
    i18n.addResourceBundle(language, "translation", loaded.default);
  }
  // A later call that finished first wins; this one is stale.
  if (request !== latestRequest) return;
  document.documentElement.lang = language;
  if (i18n.language !== language) await i18n.changeLanguage(language);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
