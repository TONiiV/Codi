import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
import * as NodePath from "node:path";
import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const at = (name) => NodePath.join(root, name);
const write = async (name, data) => {
  await NodeFSP.mkdir(NodePath.dirname(at(name)), { recursive: true });
  await NodeFSP.writeFile(at(name), data);
};

// Renders the application icons from each Icon Composer project's fill and mark scale. Icon
// Composer 2.x is the source of truth; use this where it is unavailable (`icons:export` needs macOS).
if (process.argv.includes("--app-icons")) {
  const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
  const ico = (frames) => {
    const header = Buffer.alloc(6 + 16 * frames.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(frames.length, 4);
    let offset = header.length;
    frames.forEach(({ size, png }, index) => {
      const entry = 6 + 16 * index;
      header.writeUInt8(size % 256, entry);
      header.writeUInt8(size % 256, entry + 1);
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(png.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += png.length;
    });
    return Buffer.concat([header, ...frames.map(({ png }) => png)]);
  };
  const silhouette = (png, opacity) =>
    sharp({
      create: {
        width: png.info.width,
        height: png.info.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: opacity },
      },
    }).composite([{ input: png.data, blend: "dest-in" }]);
  const squircle = async (project, size) => {
    const config = JSON.parse(await NodeFSP.readFile(at(`${project}/icon.json`), "utf8"));
    const [r, g, b] = config.fill.solid.split(":")[1].split(",").map((v) => Math.round(v * 255));
    const markSize = Math.round(size * config.groups[0].layers[0].position.scale);
    const markPng = await sharp(at("assets/brand/fold-master.png"))
      .resize(markSize, markSize)
      .png()
      .toBuffer({ resolveWithObject: true });
    const shadow = await silhouette(markPng, config.groups[0].shadow.opacity)
      .blur(size * 0.012)
      .png()
      .toBuffer();
    const offset = Math.round((size - markSize) / 2);
    return sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.2237}" fill="rgb(${r},${g},${b})"/></svg>`,
      ),
    )
      .composite([
        { input: shadow, left: offset, top: offset + Math.round(size * 0.012) },
        { input: markPng.data, left: offset, top: offset },
      ])
      .png()
      .toBuffer();
  };
  const P = BRAND_ASSET_PATHS;
  const VARIANTS = [
    {
      project: "assets/dev/app-icon.icon",
      publicDirectory: "apps/web/public",
      files: {
        ios: P.developmentIosIconPng,
        universal: P.developmentUniversalIconPng,
        mac: P.developmentDesktopIconPng,
        windows: P.developmentWindowsIconIco,
        faviconIco: P.developmentWebFaviconIco,
        favicon16: P.developmentWebFavicon16Png,
        favicon32: P.developmentWebFavicon32Png,
        touch: P.developmentWebAppleTouchIconPng,
      },
    },
    {
      project: "assets/nightly/app-icon.icon",
      files: {
        ios: P.nightlyIosIconPng,
        universal: P.nightlyLinuxIconPng,
        mac: P.nightlyMacIconPng,
        windows: P.nightlyWindowsIconIco,
        faviconIco: P.nightlyWebFaviconIco,
        favicon16: P.nightlyWebFavicon16Png,
        favicon32: P.nightlyWebFavicon32Png,
        touch: P.nightlyWebAppleTouchIconPng,
      },
    },
    {
      project: "assets/prod/app-icon.icon",
      publicDirectory: "apps/marketing/public",
      files: {
        ios: P.productionIosIconPng,
        universal: P.productionLinuxIconPng,
        mac: P.productionMacIconPng,
        windows: P.productionWindowsIconIco,
        faviconIco: P.productionWebFaviconIco,
        favicon16: P.productionWebFavicon16Png,
        favicon32: P.productionWebFavicon32Png,
        touch: P.productionWebAppleTouchIconPng,
      },
    },
  ];
  for (const { project, publicDirectory, files } of VARIANTS) {
    const full = await squircle(project, 1024);
    const small = (size) => sharp(full).resize(size, size).png().toBuffer();
    // The classic macOS icon is an 824px body inset 100px with its shadow in the margin.
    const body = await sharp(await squircle(project, 824)).toBuffer({ resolveWithObject: true });
    const shadow = await sharp(await silhouette(body, 0.35).png().toBuffer())
      .extend({ top: 40, bottom: 40, left: 40, right: 40, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .blur(14)
      .png()
      .toBuffer();
    const mac = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: shadow, left: 60, top: 72 },
        { input: body.data, left: 100, top: 100 },
      ])
      .png()
      .toBuffer();
    const windows = ico(await Promise.all(ICO_SIZES.map(async (size) => ({ size, png: await small(size) }))));
    const outputs = {
      [files.ios]: full,
      [files.universal]: full,
      [files.mac]: mac,
      [files.windows]: windows,
      [files.faviconIco]: windows,
      [files.favicon16]: await small(16),
      [files.favicon32]: await small(32),
      [files.touch]: await small(180),
    };
    for (const [name, data] of Object.entries(outputs)) await write(name, data);
    if (publicDirectory) {
      for (const [source, target] of [
        [files.faviconIco, "favicon.ico"],
        [files.favicon16, "favicon-16x16.png"],
        [files.favicon32, "favicon-32x32.png"],
        [files.touch, "apple-touch-icon.png"],
      ]) {
        await write(`${publicDirectory}/${target}`, outputs[source]);
      }
    }
  }
} else {
  const master = at("assets/brand/fold-master.png");
  const mark = await sharp(master).resize(256, 256).png().toBuffer();
  await write("assets/brand/mark.png", mark);
  const wordmark = await NodeFSP.readFile(at("assets/brand/wordmark.svg"));
  await write("assets/brand/wordmark.png", await sharp(wordmark).resize(832, 288).png().toBuffer());
  const monochrome = await NodeFSP.readFile(at("assets/brand/mark-mono.svg"), "utf8");
  for (const [variant, fill] of [
    ["prod", "srgb:0.07843,0.10588,0.12549,1.00000"],
    ["nightly", "srgb:0.13725,0.16863,0.19608,1.00000"],
    ["dev", "srgb:0.15686,0.23529,0.30588,1.00000"],
  ]) {
    const project = `assets/${variant}/app-icon.icon`;
    await NodeFSP.copyFile(master, at(`${project}/Assets/mark.png`));
    const config = JSON.parse(await NodeFSP.readFile(at(`${project}/icon.json`), "utf8"));
    config.fill = { solid: fill };
    const layer = config.groups[0].layers[0];
    layer["image-name"] = "mark.png";
    layer.name = "Fold — matte silver";
    layer.position.scale = 0.64;
    await write(`${project}/icon.json`, JSON.stringify(config, null, 2) + "\n");
  }
  const embedded = `data:image/png;base64,${mark.toString("base64")}`;
  const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 432 432"><image x="108" y="108" width="216" height="216" href="${embedded}"/></svg>`;
  for (const suffix of ["", "-ink"]) {
    await write(`apps/mobile/assets/android-icon-foreground${suffix}.svg`, adaptive);
    await write(
      `apps/mobile/assets/android-icon-foreground${suffix}.png`,
      await sharp(Buffer.from(adaptive)).png().toBuffer(),
    );
  }
  const monoBody = monochrome.match(/<path[^>]+\/>/)[0];
  const monoAdaptive = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 432 432"><g transform="translate(108 108) scale(1.6875)">${monoBody}</g></svg>`;
  await write(
    "apps/mobile/assets/android-icon-mark.png",
    await sharp(Buffer.from(monoAdaptive)).png().toBuffer(),
  );
  await write(
    "apps/mobile/assets/android-notification-icon.png",
    await sharp(Buffer.from(monochrome.replace("#f4f3ef", "#ffffff")))
      .resize(96, 96)
      .png()
      .toBuffer(),
  );
  await write("apps/mobile/assets/widget/T3Mark.svg", monochrome.replace("#f4f3ef", "#000000"));
  await write(
    "assets/prod/logo.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#141b20"/><image x="12" y="12" width="104" height="104" href="${embedded}"/></svg>`,
  );
  for (const directory of ["apps/web/public/brand", "apps/marketing/public/brand"]) {
    await write(`${directory}/mark.png`, mark);
    await write(`${directory}/wordmark.svg`, wordmark);
  }
}
await NodeFSP.copyFile(at("assets/brand/banner.png"), at("apps/marketing/public/brand/banner.png"));
console.log("Codi Fold assets exported.");
