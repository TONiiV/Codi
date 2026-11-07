import { visit } from "jsonc-parser";
import { describe, expect, it } from "vite-plus/test";

import en from "./locales/en.json";
import enText from "./locales/en.json?raw";
import zhCN from "./locales/zh-CN.json";
import zhCNText from "./locales/zh-CN.json?raw";

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

const leaves = (node: unknown, path = ""): Array<readonly [string, unknown]> =>
  typeof node === "object" && node !== null
    ? Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key))
    : [[path, node]];

// JSON.parse keeps the last of two equal keys silently, so duplicates are only visible in the text.
const duplicateKeys = (text: string) => {
  const objects: Array<{ readonly path: string; readonly keys: Set<string> }> = [];
  const duplicates: Array<string> = [];
  let property = "";
  visit(text, {
    onObjectBegin: () => {
      const parent = objects.at(-1);
      objects.push({ path: parent ? `${parent.path}${property}.` : "", keys: new Set() });
    },
    onObjectProperty: (name) => {
      const current = objects.at(-1);
      if (current?.keys.has(name)) duplicates.push(`${current.path}${name}`);
      current?.keys.add(name);
      property = name;
    },
    onObjectEnd: () => {
      objects.pop();
    },
  });
  return duplicates;
};

describe("locale files", () => {
  it("define the same usable keys with the same interpolation placeholders", () => {
    expect(shapes("zh-CN", zhCN)).toEqual(shapes("en", en));
  });

  it("define each key once per object", () => {
    expect(duplicateKeys(enText)).toEqual([]);
    expect(duplicateKeys(zhCNText)).toEqual([]);
  });

  it("have no zh-CN value made only of ASCII punctuation, which is what a lost encoding leaves", () => {
    const lostEncodings = leaves(zhCN).filter(([, value]) => {
      const text = String(value).replaceAll(/\{\{[^}]*\}\}|<\/?\w+\s*\/?>/g, "");
      return text.trim() !== "" && /^[\s\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]*$/.test(text);
    });
    expect(lostEncodings).toEqual([]);
  });
});
