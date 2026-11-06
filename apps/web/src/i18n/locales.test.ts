import { describe, expect, it } from "vite-plus/test";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

// Each key maps to its sorted placeholders, or a per-locale marker when the value is not a usable
// translation, so a missing key, a renamed placeholder and a blank or non-string value all differ.
const leafShape = (locale: string, value: unknown) =>
  typeof value === "string" && value.trim() !== ""
    ? [...value.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((match) => `{{${match[1]}}}`).toSorted()
    : `<unusable ${locale}: ${JSON.stringify(value)}>`;

const shapes = (locale: string, node: unknown, path = ""): Record<string, unknown> =>
  typeof node === "object" && node !== null
    ? Object.assign(
        {},
        ...Object.entries(node).map(([key, value]) =>
          shapes(locale, value, path ? `${path}.${key}` : key),
        ),
      )
    : { [path]: leafShape(locale, node) };

describe("locale files", () => {
  it("define the same usable keys with the same interpolation placeholders", () => {
    expect(shapes("zh-CN", zhCN)).toEqual(shapes("en", en));
  });
});
