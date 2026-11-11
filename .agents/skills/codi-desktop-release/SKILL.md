---
name: codi-desktop-release
description: Build, update, or reinstall the local Codi desktop app from main on macOS or Windows while preserving its database, relay configuration, account, and projects.
---

# Build and install Codi desktop

Codi runs as the developer's only desktop app. It reuses everything the
official T3 Code app owned, so no migration step exists.

## Platform routing

- **macOS:** use `update-codi.sh`; the detailed macOS procedure remains below.
- **Windows x64:** use `update-codi.ps1` and read
  [references/windows.md](references/windows.md) before installing prerequisites
  or troubleshooting a failed build.
- **Other hosts:** stop and report that this skill has no install workflow for
  the platform or architecture.

Shared state locations:

| What                                                | Where                                                                            | Why Codi sees it                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Threads, projects, settings, secrets                | `~/.t3/userdata` (`statev2.sqlite`)                                              | `T3CODE_HOME` is left at its default                 |
| Clerk login, saved environments, connection catalog | macOS: `~/Library/Application Support/t3code-v2`; Windows: `%APPDATA%\t3code-v2` | userData name is unchanged                           |
| macOS Keychain key for `safeStorage`                | `t3code Safe Storage`                                                            | runtime app name is fixed in `DesktopAppIdentity.ts` |
| Relay URL, Clerk keys                               | baked at build time                                                              | from `.env` (copied from `.env.example`)             |

Only the bundle identity changes: `appId com.tonic.codi`, `productName Codi`
(Windows also raises the payload file limit; see
[references/windows.md](references/windows.md)). A distinct bundle id keeps
LaunchServices from mixing it up with an official download. The build has no
update feed, so it never auto-updates back to official T3 Code.

## Hard rules

- Never run Codi and an official T3 Code app at the same time. Both would open
  `~/.t3`. The shared userData single-instance lock normally prevents this; do
  not change the userData name to "fix" a lock conflict — quit the other app.
- Snapshot `statev2.sqlite` (not `state.sqlite`, which is a stale v1 file)
  before installing. A new build runs Codi-only migrations (Telescope, etc.)
  on the live database, and the official app cannot roll them back.
- Never commit the identity patch. It is local-only.

## Windows update

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/codi-desktop-release/update-codi.ps1
```

The script stops if official T3 Code is running, uses a detached `origin/main`
worktree, applies the local identity, builds and verifies an x64 NSIS
installer, gracefully closes only processes running from the installed Codi
directory, snapshots `statev2.sqlite` when present, installs, verifies the
installed version, cleans up, and launches. It never installs prerequisites: it stops when the Rust MSVC toolchain or target
is missing, and changing Visual Studio, Rust, or Python needs explicit user
authorization. Pass `-Branch <name>` to build another branch and `-NoLaunch` to
skip the final launch. Run it in the background when invoking it as an agent; it
closes the running Codi, so never run it from inside a Codi thread without the
developer's go-ahead.

## macOS update

```bash
.agents/skills/codi-desktop-release/update-codi.sh          # origin/main
.agents/skills/codi-desktop-release/update-codi.sh <branch> # another branch
```

It runs every step below: worktree from `origin/<branch>`, identity patch,
build, dmg verification, quitting Codi gracefully, `statev2.sqlite` snapshot,
install, ad-hoc sign, worktree cleanup, launch. It stops with a message on any
failed check. Build log goes to `~/codi-local/last-build.log`; dmg and backups
land in `~/codi-local/`. Run it in the background when invoking it as an
agent — it quits the running Codi, so never run it from inside a Codi thread
without the developer's go-ahead.

The manual steps below explain what the script does and what to fix when a
step breaks.

## Steps

Local shell quirks: `grep` is ugrep (use `/usr/bin/grep`), `vp` is not on
PATH, and agent shells may inherit `ELECTRON_RUN_AS_NODE=1`.

1. Fresh worktree from up-to-date main:

   ```bash
   git -C <repo> pull --ff-only
   git -C <repo> worktree add .worktrees/codi-release main --detach
   cd <repo>/.worktrees/codi-release
   cp .env.example .env
   ../../node_modules/.bin/vp i
   ```

2. Apply the identity patch (appId + productName + artifact name in
   `scripts/build-desktop-artifact.ts`):

   ```bash
   sed -i '' \
     -e 's/    appId: DESKTOP_APP_ID,/    appId: "com.tonic.codi",/' \
     -e 's/    productName: resolveDesktopProductName(version),/    productName: "Codi",/' \
     -e 's/artifactName: "T3-Code-\${version}/artifactName: "Codi-${version}/' \
     scripts/build-desktop-artifact.ts
   git diff --stat   # expect only scripts/build-desktop-artifact.ts
   ```

   If a `sed` pattern no longer matches, read `createBuildConfig` and redo the
   three edits by hand. Do not touch `DesktopUserData.ts` or add
   `LSEnvironment` — those belong to the old coexist setup and would split the
   data away from `~/.t3`.

3. Build (about 2–3 minutes):

   ```bash
   env -u ELECTRON_RUN_AS_NODE -u GITHUB_REPOSITORY -u T3CODE_DESKTOP_UPDATE_REPOSITORY \
     ./node_modules/.bin/vp run dist:desktop:dmg:arm64
   ```

   Output: `release/Codi-<version>-arm64.dmg`. Unsetting the two repository
   variables keeps the update feed out of the bundle.

4. Verify the dmg before installing: mount it, then check
   `CFBundleIdentifier` is `com.tonic.codi`, `Contents/Resources` has no
   `app-update.yml`, and `strings app.asar` contains `relay.t3.codes` and the
   `pk_live_` Clerk key.

5. Quit Codi (and any official T3 Code), snapshot the database, install:

   ```bash
   B=~/codi-local/t3-backup-$(date +%Y%m%d-%H%M); mkdir -p "$B"
   bun -e "new (require('bun:sqlite').Database)(process.env.HOME + '/.t3/userdata/statev2.sqlite', { readonly: true }).run(\"VACUUM INTO '$B/statev2.sqlite'\")"
   mv /Applications/Codi.app ~/.Trash/Codi-previous.app
   ditto <mount>/Codi.app /Applications/Codi.app
   xattr -cr /Applications/Codi.app
   codesign --force --deep --sign - /Applications/Codi.app
   env -u ELECTRON_RUN_AS_NODE open /Applications/Codi.app
   ```

6. Confirm it landed on the real data: the server process (the
   `Codi --require ...` child) should hold `~/.t3/userdata/statev2.sqlite`
   open (`lsof -p <pid>`), the helper processes should show
   `--user-data-dir=.../t3code-v2`, and the projects list should not be empty.
   The first launch of an ad-hoc signed build may show a Keychain prompt for
   `t3code Safe Storage`; "Always Allow" keeps the login.

7. Keep the dmg in `~/codi-local/`, then remove the worktree
   (`git worktree remove --force .worktrees/codi-release`).
