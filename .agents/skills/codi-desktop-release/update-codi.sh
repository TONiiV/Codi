#!/usr/bin/env bash
# Rebuild Codi from origin/main and reinstall /Applications/Codi.app on top of ~/.t3.
# Usage: .agents/skills/codi-desktop-release/update-codi.sh [branch]   (default: main)
set -euo pipefail

BRANCH="${1:-main}"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WT="$REPO/.worktrees/codi-release"
OUT="$HOME/codi-local"
APP=/Applications/Codi.app
DB="$HOME/.t3/userdata/statev2.sqlite"
VP="$REPO/node_modules/.bin/vp"
GREP=/usr/bin/grep
log() { printf '\n==> %s\n' "$*"; }

[ -x "$VP" ] || { echo "missing $VP — run vp i in $REPO first" >&2; exit 1; }
command -v bun >/dev/null || { echo "bun is required for the DB snapshot" >&2; exit 1; }
mkdir -p "$OUT"

log "Worktree from origin/$BRANCH"
git -C "$REPO" fetch -q origin "$BRANCH"
if [ -d "$WT" ]; then git -C "$REPO" worktree remove --force "$WT"; fi
git -C "$REPO" worktree add -q --detach "$WT" "origin/$BRANCH"
cd "$WT"
echo "commit: $(git log --oneline -1)"
cp .env.example .env
"$VP" i >/dev/null

log "Identity patch"
F=scripts/build-desktop-artifact.ts
sed -i '' \
  -e 's/    appId: DESKTOP_APP_ID,/    appId: "com.tonic.codi",/' \
  -e 's/    productName: resolveDesktopProductName(version),/    productName: "Codi",/' \
  -e 's/artifactName: "T3-Code-\${version}/artifactName: "Codi-${version}/' \
  "$F"
for want in 'appId: "com.tonic.codi"' 'productName: "Codi"' 'artifactName: "Codi-'; do
  $GREP -q "$want" "$F" || { echo "patch did not apply: $want — redo createBuildConfig edits by hand" >&2; exit 1; }
done

log "Build dmg (2-3 min)"
rm -rf release
env -u ELECTRON_RUN_AS_NODE -u GITHUB_REPOSITORY -u T3CODE_DESKTOP_UPDATE_REPOSITORY \
  ./node_modules/.bin/vp run dist:desktop:dmg:arm64 >"$OUT/last-build.log" 2>&1 \
  || { tail -30 "$OUT/last-build.log"; exit 1; }
DMG="$(ls release/Codi-*-arm64.dmg)"
cp "$DMG" "$OUT/"

log "Verify dmg"
MNT="$(mktemp -d)/mnt"
hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$DMG"
trap 'hdiutil detach -quiet "$MNT" 2>/dev/null || true' EXIT
NEW="$MNT/Codi.app"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$NEW/Contents/Info.plist")" = com.tonic.codi ] \
  || { echo "wrong bundle id" >&2; exit 1; }
[ ! -e "$NEW/Contents/Resources/app-update.yml" ] || { echo "update feed baked in; refusing" >&2; exit 1; }
# grep -c reads all input; grep -q would exit early, SIGPIPE strings, and fail under pipefail.
strings "$NEW/Contents/Resources/app.asar" | $GREP -c relay.t3.codes >/dev/null || { echo "relay URL missing; check .env" >&2; exit 1; }

log "Quit Codi"
if pgrep -xq Codi; then
  osascript -e 'quit app "Codi"'
  for _ in $(seq 60); do pgrep -xq Codi || break; sleep 1; done
  ! pgrep -xq Codi || { echo "Codi did not quit; close it and rerun" >&2; exit 1; }
fi
if pgrep -fq "/Applications/T3 Code"; then echo "official T3 Code is running; quit it first" >&2; exit 1; fi

log "Snapshot $DB"
B="$OUT/t3-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$B"
DB="$DB" B="$B" bun -e "new (require('bun:sqlite').Database)(process.env.DB, { readonly: true }).run(\"VACUUM INTO '\" + process.env.B + \"/statev2.sqlite'\")"
echo "backup: $B/statev2.sqlite"

log "Install"
if [ -d "$APP" ]; then mv "$APP" "$HOME/.Trash/Codi-$(date +%Y%m%d-%H%M%S).app"; fi
ditto "$NEW" "$APP"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP" 2>/dev/null
codesign -v "$APP"

log "Clean up and launch"
cd "$REPO"
git worktree remove --force "$WT"
env -u ELECTRON_RUN_AS_NODE open "$APP"
echo "Installed $(basename "$DMG"). Previous app is in ~/.Trash; DB backup in $B."
