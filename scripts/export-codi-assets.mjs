import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
import * as NodePath from "node:path";
import sharp from "sharp";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const at = (name) => NodePath.join(root, name);
const write = async (name, data) => {
  await NodeFSP.mkdir(NodePath.dirname(at(name)), { recursive: true });
  await NodeFSP.writeFile(at(name), data);
};

// Run after icons:export to publish the production renditions to the marketing site.
if (process.argv.includes("--public")) {
  const pairs = [
    ["black-universal-1024.png", "icon.png"],
    ["t3-black-web-favicon.ico", "favicon.ico"],
    ["t3-black-web-favicon-16x16.png", "favicon-16x16.png"],
    ["t3-black-web-favicon-32x32.png", "favicon-32x32.png"],
    ["t3-black-web-apple-touch-180.png", "apple-touch-icon.png"],
  ];
  for (const [source, target] of pairs) {
    await NodeFSP.copyFile(at(`assets/prod/${source}`), at(`apps/marketing/public/${target}`));
    if (target.endsWith(".png")) {
      await sharp(at(`assets/prod/${source}`))
        .webp({ lossless: true })
        .toFile(at(`apps/marketing/public/${target.replace(".png", ".webp")}`));
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
