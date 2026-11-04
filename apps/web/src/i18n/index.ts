import type { AppLanguage } from "@t3tools/contracts/settings";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export function resolveLanguage(
  preference: AppLanguage,
  systemLanguage = navigator.language,
): Exclude<AppLanguage, "system"> {
  if (preference !== "system") return preference;
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function applyLanguage(preference: AppLanguage): void {
  const language = resolveLanguage(preference);
  document.documentElement.lang = language;
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  lng: resolveLanguage("system"),
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
});
