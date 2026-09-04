# Brand icons

The three Icon Composer projects are the source of truth for full application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project draws the Codi mark from `mark.svg` over a solid fill: a serif C followed by a block
cursor, in the editorial paper/ink palette. Layer names describe their role and placement, so a
project with more than one layer stays readable.

| Project                 | Fill            | Mark            |
| ----------------------- | --------------- | --------------- |
| `prod/app-icon.icon`    | paper `#F5F3F0` | ink `#16130F`   |
| `nightly/app-icon.icon` | shell `#100F0D` | paper `#F5F3F0` |
| `dev/app-icon.icon`     | cool `#2F4D86`  | paper `#F5F3F0` |

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

## Android adaptive foreground

Android draws the launcher foreground over a flat background colour, and the production background is
paper while dev and preview are dark, so there are two foregrounds:

- `apps/mobile/assets/android-icon-foreground.svg` — paper mark, used by dev and preview.
- `apps/mobile/assets/android-icon-foreground-ink.svg` — ink mark, used by production.

Export the paired PNG after changing either one:

```sh
rsvg-convert -w 432 -h 432 \
  -o apps/mobile/assets/android-icon-foreground.png \
  apps/mobile/assets/android-icon-foreground.svg
```

The foreground must remain transparent and keep the Codi mark inside Android's adaptive-icon safe
zone. `android-icon-mark.png` remains a flat silhouette for Android's monochrome themed icon.

## In-app lockup

The sidebar and mobile header draw the same mark inline rather than loading a PNG:
`apps/web/src/components/sidebar/SidebarChrome.tsx` and
`apps/mobile/src/components/CodiMark.tsx`. Keep their path data in sync with `mark.svg`.
