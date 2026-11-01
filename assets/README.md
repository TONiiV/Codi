# Brand icons

The three Icon Composer projects are the source of truth for full application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

The Codi Fold identity uses a satin silver ribbon with a subtle ice-blue inner face and rounded
lettering. `brand/fold-master.png` is the approved raster master (generated with the built-in
imagegen tool from the selected Fold concept); `brand/wordmark.svg` is the clean vector wordmark.
`brand/mark-mono.svg` is the simplified silhouette for notification and widget template rendering.
`brand/banner.png` is the marketing banner. All are static assets; clients add no animated lighting.

Run `node scripts/export-codi-assets.mjs` before exporting icons. It synchronizes the master into
Icon Composer, generates small in-app renditions and Android assets, and publishes the wordmark
and banner. Each Icon Composer project uses `Assets/mark.png` as its foreground.

| Project                 | Background          |
| ----------------------- | ------------------- |
| `prod/app-icon.icon`    | graphite `#141B20`  |
| `nightly/app-icon.icon` | slate `#232B32`     |
| `dev/app-icon.icon`     | blue-gray `#283C4E` |

**Export status:** the Fold source projects are updated, but the tracked full application PNG/ICO
renditions and browser favicons still contain the previous identity. This workstation has Icon
Composer 1.5; the maintainer requested retaining the 2.x / generation 26 requirement. Regenerate
these on a machine with Icon Composer 2.x before releasing this rebrand. Native macOS exports
remain required as described below. After exporting, run
`node scripts/export-codi-assets.mjs --public` to update marketing PNG/WebP icons and favicons.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

Icon Composer's command-line exporter does not expose the `macOS pre-Tahoe` preset. A plain command-line `macOS` export is full bleed and is not suitable for the desktop app, so the export script intentionally leaves the tracked macOS PNGs unchanged and prints a reminder after every run.

After changing an Icon Composer project, open it in Icon Composer and export the macOS PNG with exactly these settings:

- Platform: `macOS pre-Tahoe`
- Appearance: `Default`
- Size: `1024pt`
- Scale: `1×`

Save the three exports to:

- `dev/app-icon.icon` -> `dev/blueprint-macos-1024.png`
- `nightly/app-icon.icon` -> `nightly/nightly-macos-1024.png`
- `prod/app-icon.icon` -> `prod/black-macos-1024.png`

The result must be a 1024×1024 PNG with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native Icon Composer shadow extending into the surrounding transparent canvas.

To have Codex perform the native exports, paste this prompt into a task opened at the repository root:

```text
Use [@Computer](plugin://computer-use@openai-bundled) and the Icon Composer app to export the three macOS app icons in this repository.

For each project below, use Platform: macOS pre-Tahoe, Appearance: Default, Size: 1024pt, and Scale: 1×, then save the PNG to the exact destination:

- assets/dev/app-icon.icon -> assets/dev/blueprint-macos-1024.png
- assets/nightly/app-icon.icon -> assets/nightly/nightly-macos-1024.png
- assets/prod/app-icon.icon -> assets/prod/black-macos-1024.png

Do not resize, composite, or otherwise post-process the exported PNGs.

Verify every result is 1024×1024 and has the classic macOS safe area: an 824×824 opaque body inset 100px on every side, with only Icon Composer's native shadow extending beyond it.
```

Do not edit the generated PNG or ICO files directly.

## Android launcher and splash artwork

All variants use the same transparent Fold foreground, centered in the adaptive icon safe zone.
The background colors match the table above. The `-ink` filename remains as a compatibility copy
for existing asset consumers, but contains the same silver mark. Generate both PNG/SVG copies,
monochrome launcher and notification assets with `node scripts/export-codi-assets.mjs`.

`vp run icons:export:android` still renders the previous wordmark artwork and overwrites
`android-icon-foreground.png`. Do not run it until it is ported to the Fold mark.

## In-app lockup

Web and desktop use `/brand/mark.png` and a CSS mask of `/brand/wordmark.svg`, so lettering follows
the current foreground color in light/dark themes and custom backdrops. Mobile uses the same
small raster mark and a theme-tinted rendering of the vector lettering through `CodiMark` and
`CodiWordmark`. Both the compact navigation title and home header use these components.
The widget retains the `T3Mark` resource identifier for compatibility, with the new Fold silhouette.

The artwork has no font dependency. Do not replace the rounded wordmark with system text or apply
extra shadows/glow to the small in-app mark.
