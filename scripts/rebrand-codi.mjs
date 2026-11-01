#!/usr/bin/env node

// Re-applies the "T3 Code" -> "Codi" rename to user-visible copy. Run it after merging upstream.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const TEXT_FILE =
  /\.(?:[cm]?[jt]sx?|md|mdx|astro|html|ya?ml|json|txt|webmanifest|xml|kt|podspec|sh)$/;
// Vendored code, recorded provider transcripts, model evals, native helpers, third-party patches,
// the installer banners drawn next to the old logo, files that name existing installs, and tests
// whose fixtures are matched by a "t3" query or a legacy path pattern.
const SKIP_PATH =
  /^(?:\.repos|evals|native|patches)\/|\.ndjson$|(?:^|\/)(?:pnpm-lock\.yaml|tweets\.ts|install\.(?:sh|ps1)|installer\.nsh|paletteSearch\.test\.ts|DesktopAppIdentity\.test\.ts|DesktopUserData(?:\.test)?\.ts|DesktopLegacyLocalStorage(?:\.test)?\.ts)$/;
// Previous app and profile names that exist on disk, and the client name sent to providers.
const SKIP_LINE = /T3 Code \((?:Alpha|Dev|Beta|Nightly)\)|CODEX_CLIENT_NAME|clientInfo/;

const files = NodeChildProcess.execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .split("\0")
  .filter((file) => TEXT_FILE.test(file) && !SKIP_PATH.test(file));

let changed = 0;
for (const file of files) {
  const source = NodeFS.readFileSync(file, "utf8");
  if (!source.includes("T3 Code")) continue;
  const next = source
    .split("\n")
    .map((line) => (SKIP_LINE.test(line) ? line : line.replaceAll("T3 Code", "Codi")))
    .join("\n");
  if (next === source) continue;
  NodeFS.writeFileSync(file, next);
  changed++;
}
console.log(`Renamed T3 Code to Codi in ${changed} files.`);
