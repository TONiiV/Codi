#!/usr/bin/env node

// During an upstream merge, resolves the conflicts that exist only because the fork renamed
// "T3 Code" to "Codi" on lines upstream also changed: it merges again with the fork's rename
// undone, then renames the result. A file is taken only when that merge is clean and undoing the
// rename is lossless, so real conflicts are left for the next step. Prints the files it resolved.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { isRenamed, renameText } from "./rebrand-codi.mjs";

const git = (args, options = {}) =>
  NodeChildProcess.spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28, ...options });

const stage = (number, file) => {
  const shown = git(["show", `:${number}:${file}`]);
  return shown.status === 0 ? shown.stdout : undefined;
};

const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "rebrand-conflicts-"));
const conflicted = git(["diff", "--name-only", "--diff-filter=U", "-z"])
  .stdout.split("\0")
  .filter(Boolean);

for (const file of conflicted) {
  if (!isRenamed(file)) continue;
  const [base, ours, theirs] = [1, 2, 3].map((number) => stage(number, file));
  if (base === undefined || ours === undefined || theirs === undefined) continue;
  const upstreamNamed = ours.replaceAll("Codi", "T3 Code");
  if (renameText(file, upstreamNamed) !== ours) continue;
  const paths = { ours: upstreamNamed, base, theirs };
  for (const [name, text] of Object.entries(paths)) {
    NodeFS.writeFileSync(NodePath.join(scratch, name), text);
  }
  const merged = git(
    ["merge-file", "-p", ...["ours", "base", "theirs"].map((name) => NodePath.join(scratch, name))],
    { cwd: scratch },
  );
  if (merged.status !== 0) continue;
  NodeFS.writeFileSync(file, renameText(file, merged.stdout));
  git(["add", "--", file]);
  console.log(file);
}
NodeFS.rmSync(scratch, { recursive: true });
