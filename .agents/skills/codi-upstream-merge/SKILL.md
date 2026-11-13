---
name: codi-upstream-merge
description: Rules and fix patterns for resolving a merge of pingdotgg/t3code (upstream) into Codi and fixing what check:changed reports after it. The Upstream sync workflow's Claude step runs on it; use it too when resolving such a merge by hand. For diagnosing the workflow itself, use codi-upstream-sync.
---

# Resolve an upstream merge into Codi

This repository is TONiiV/Codi (product name "Codi"), a fork of pingdotgg/t3code (upstream,
product name "Codi"). A nightly job merges upstream into the fork. Scripts have already
resolved the conflicts that come only from the Codi rename, and `agentContextBudget.json`.
What reaches you needs judgment.

## Policy, in this order

1. **Upstream wins.** Take upstream's logic, structure, copy and file layout. When upstream
   deleted or replaced a file or a feature, accept that (`git rm` a file it deleted), even when
   the fork had changes there. This includes `.macroscope/` and everything else not in rule 2.
2. **Keep these fork things** on top of upstream's version:
   - Telescope: `apps/server/src/telescope`, `apps/web/src/components/telescope`, Telescope
     RPCs, settings, layers and navigation.
   - i18n in `apps/web`: a `t("key")` call stays when its key exists in
     `apps/web/src/i18n/locales/en.json`. When upstream reworded that string, update the value in
     `en.json`. Text upstream added stays an English literal: add no keys. Fork helpers take a
     `t` argument, such as `searchableSetting(id, t)`.
   - The settings search catalog is the exception to "add no keys": every item in
     `settingsSearch.ts` needs `settings.items.<id>` and `settings.itemTerms.<id>` in `en.json`
     and `zh-CN.json`, matching the catalog's title and search terms. An item upstream removed
     loses its keys.
   - The theme backdrop, brand assets under `brand/`, the language setting, the fork's own
     `README.md`, and `runs-on: ubuntu-24.04` in workflows.
3. **Both sides added different things at the same place:** keep both.
4. **Write product text as upstream has it ("Codi").** A script renames it afterwards.
5. **A fork quarantine** (`// quarantine: #N <why>` above an `it.skip`) on a test upstream
   changed or renamed: take upstream's test and put the same comment and `.skip` on it. If
   upstream deleted that scenario, drop the quarantine.
6. **Never** skip, disable or delete a test to make a check pass. Except for a conflicted file,
   never edit `.github/`, `scripts/` or files under `.repos/`.
7. **Migrations:** upstream's live in `apps/server/src/persistence/Migrations/` and
   `Migrations.ts`, with upstream's ids. Codi's live in `Migrations/codi/` and `CodiMigrations.ts`,
   with their own table and ids. Take upstream's migration files and entries as they are. Never
   renumber, move or edit a migration that has shipped: databases already recorded it under its
   id, and the migrator skips every id up to the highest one recorded.

**Changes for the maintainer.** Adapting Telescope code to a changed upstream API is fine. When a
change alters how Telescope behaves or looks, or you had to edit a file outside the conflicts,
make your best choice and add one line per change to the review file the task names. The job
then opens a pull request for the maintainer instead of pushing to main. The job also lists every
file you changed outside the conflicts there by itself.

**Report.** Append to the report file the task names, in Chinese, one short line per file you
changed. End with two lists: fork changes that upstream's side replaced, and new upstream UI
text that still needs i18n keys.

## Resolving conflicts

- Read all three sides before deciding: `git show :1:<file>` (base), `:2:` (fork), `:3:`
  (upstream). A fork side that differs from the base only by `Codi` where the base says
  `Codi` has no fork change: take upstream's side.
- i18n files (most of `apps/web/src/components`): take upstream's JSX and logic, then put the
  fork's `t("…")` back on each string whose key exists. Upstream's new hooks, props and
  components come in as they are; keep `const { t } = useTranslation();` in each component that
  still calls `t`.
- Two sides adding a declaration at the same spot often share one closing `});` or `}` after
  the markers. Keeping both sides naively leaves the first one unclosed. Close it.
- `CONFLICT (modify/delete)`: upstream deleted the file. `git rm` it and follow upstream's
  replacement.
- `pnpm-lock.yaml`: resolve the `package.json` files first, then
  `git checkout --theirs pnpm-lock.yaml` and `vp install --no-frozen-lockfile`.
- Leave no conflict markers and `git add` every file you resolve. Do not commit, push or switch
  branches.

## Fixing check:changed failures

Make the smallest change, and confirm it with the same check on the files you changed:
`vp run typecheck`, `vp test run <files>`, `vp lint <files>`. Do not commit.

- **Many errors that say `unknown` in the requirements or error channel** (often in
  `binCli.ts` and CLI tests) come from one real error that collapsed a layer's type. Find that
  error first. `TS2554: Expected 0-20 arguments, but got 21` on a `.pipe(` means Effect's pipe
  limit: move the fork's arguments into a helper such as `provideTelescope` in
  `apps/server/src/server.ts`. Do not split the pipe; the formatter reindents it and later
  merges conflict.
- **A fork call no longer matches upstream's API** (new required prop or argument, renamed
  export, a type upstream stopped exporting or importing): adapt the fork code to upstream.
  For a new required input, pick the value upstream passes at its own call sites.
- **`settingsSearch.test.ts`: "locale keys whose English matches the catalog":** fix
  `settings.items.<id>` and `settings.itemTerms.<id>` in `en.json` (and the `zh-CN.json`
  entry) to match `settingsSearch.ts`. Add keys for new items, remove keys of deleted ones.
- **A test expects `Codi` and gets `Codi`, or the reverse:** the rename script changed one
  side only. You cannot edit `scripts/`. Report the file and line instead of changing the test.
- **A failure that is not caused by the merge** (it also fails on upstream, or needs a
  machine resource): leave it and report it.
