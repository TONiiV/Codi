import { describe, expect, it } from "vite-plus/test";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

const flatten = (node: unknown, path = ""): Array<[string, unknown]> =>
  typeof node === "object" && node !== null
    ? Object.entries(node).flatMap(([key, value]) => flatten(value, path ? `${path}.${key}` : key))
    : [[path, node]];

const placeholders = (value: unknown) =>
  typeof value === "string" ? (value.match(/\{\{[^}]*\}\}/g) ?? []).toSorted() : [];

const enEntries = new Map(flatten(en));
const zhEntries = new Map(flatten(zhCN));

describe("locale files", () => {
  it("define the same keys", () => {
    const missingInZh = [...enEntries.keys()].filter((key) => !zhEntries.has(key)).toSorted();
    const extraInZh = [...zhEntries.keys()].filter((key) => !enEntries.has(key)).toSorted();
    expect({ missingInZh, extraInZh }).toEqual({ missingInZh: [], extraInZh: [] });
  });

  it("use the same interpolation placeholders per key", () => {
    const mismatched = [...enEntries]
      .filter(([key]) => zhEntries.has(key))
      .map(([key, value]) => ({
        key,
        en: placeholders(value),
        zh: placeholders(zhEntries.get(key)),
      }))
      .filter((entry) => entry.en.join() !== entry.zh.join());
    expect(mismatched).toEqual([]);
  });

  it("have no empty translations", () => {
    const empty = [
      ...[...enEntries].filter(([, value]) => value === "").map(([key]) => `en:${key}`),
      ...[...zhEntries].filter(([, value]) => value === "").map(([key]) => `zh-CN:${key}`),
    ];
    expect(empty).toEqual([]);
  });
});
