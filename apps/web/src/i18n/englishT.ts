import { createInstance, type TFunction } from "i18next";

import en from "./locales/en.json";

const english = createInstance();
void english.init({
  resources: { en: { translation: en } },
  lng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
});

/** Default for logic helpers that take a `t`, so they and their tests need no running app i18n. */
export const englishT: TFunction = english.t.bind(english);
