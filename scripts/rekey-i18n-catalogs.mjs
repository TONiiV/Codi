#!/usr/bin/env node

// GT catalogs key each string by a hash of its source text, so the Codi rename leaves en.json and
// every locale catalog under the old keys. Run after rebrand-codi.mjs: it moves each stale entry
// to the key `gt generate` now gives the same (already renamed) English text.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

// Same commands as scripts/i18n-check.ts.
const GENERATE = {
  "apps/web": ["node_modules/.bin/gt", "generate"],
  "apps/mobile": ["node_modules/.bin/gt", "generate"],
  "apps/desktop": [process.execPath, "scripts/i18n-generate.mjs"],
};

const root = NodePath.resolve(import.meta.dirname, "..");
const readJson = (file) => JSON.parse(NodeFS.readFileSync(file, "utf8"));
// The formatter may rewrap JSX after the rename shortens a line, which splits `<T>` text
// differently, so entries compare by their text with whitespace collapsed.
const textOf = (value) =>
  (Array.isArray(value)
    ? value.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join("")
    : JSON.stringify(value)
  ).replaceAll(/\s+/g, " ");

for (const [app, [command, ...args]] of Object.entries(GENERATE)) {
  const appDir = NodePath.join(root, app);
  const configPath = NodePath.join(appDir, "gt.config.json");
  if (!NodeFS.existsSync(configPath)) continue;
  const config = readJson(configPath);
  const catalogDir = NodePath.join(appDir, NodePath.dirname(config.files.gt.output));
  const sourcePath = NodePath.join(catalogDir, `${config.defaultLocale}.json`);
  const source = readJson(sourcePath);

  const tmp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "i18n-rekey-"));
  let generated;
  try {
    const tmpConfig = NodePath.join(tmp, "gt.config.json");
    NodeFS.writeFileSync(
      tmpConfig,
      JSON.stringify({ ...config, locales: [], files: { gt: { output: `${tmp}/[locale].json` } } }),
    );
    NodeChildProcess.execFileSync(command, [...args, "--config", tmpConfig], {
      cwd: appDir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    generated = readJson(NodePath.join(tmp, `${config.defaultLocale}.json`));
  } finally {
    NodeFS.rmSync(tmp, { recursive: true, force: true });
  }

  // Text that appears under several keys (same words, different context) is left alone.
  const keyByText = new Map();
  for (const [key, text] of Object.entries(generated)) {
    const id = textOf(text);
    keyByText.set(id, keyByText.has(id) ? null : key);
  }
  const moves = new Map();
  for (const [key, text] of Object.entries(source)) {
    if (Object.hasOwn(generated, key)) continue;
    const next = keyByText.get(textOf(text));
    if (next && !Object.hasOwn(source, next)) moves.set(key, next);
  }
  if (moves.size === 0) continue;

  for (const locale of [config.defaultLocale, ...config.locales]) {
    const file = NodePath.join(catalogDir, `${locale}.json`);
    const catalog = readJson(file);
    const rekeyed = Object.fromEntries(
      Object.entries(catalog).map(([key, value]) =>
        moves.has(key)
          ? [moves.get(key), locale === config.defaultLocale ? generated[moves.get(key)] : value]
          : [key, value],
      ),
    );
    NodeFS.writeFileSync(file, `${JSON.stringify(rekeyed, null, 2)}\n`);
  }
  console.log(`${app}: moved ${moves.size} renamed strings to their new catalog keys.`);
}
