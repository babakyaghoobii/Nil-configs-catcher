// Build application assets from the creator's supplied artwork. No redrawing.
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const charcoal = "assets/branding/nil-logo-charcoal.png";
const transparent = "assets/branding/nil-logo-transparent.png";
const scratch = await mkdtemp(join(tmpdir(), "nil-brand-icons-"));
const cli = "node_modules/@tauri-apps/cli/tauri.js";

function rasterize(input, sizes, directory) {
  const args = [cli, "icon", input, "--output", directory];
  for (const size of sizes) args.push("--png", String(size));
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Logo asset generation failed");
}

try {
  await mkdir("public/branding", { recursive: true });
  await mkdir("public/icons", { recursive: true });
  const darkOutput = join(scratch, "charcoal");
  rasterize(charcoal, [32, 180, 192, 512, 640], darkOutput);
  for (const [size, name] of [
    [32, "favicon-32.png"],
    [180, "apple-touch-icon.png"],
    [192, "icon-192.png"],
    [512, "icon-512.png"],
  ]) {
    await copyFile(
      join(darkOutput, `${size}x${size}.png`),
      `public/icons/${name}`,
    );
  }
  await copyFile(
    join(darkOutput, "640x640.png"),
    "public/branding/creator-logo-charcoal.png",
  );
  const lightOutput = join(scratch, "transparent");
  rasterize(transparent, [640], lightOutput);
  await copyFile(
    join(lightOutput, "640x640.png"),
    "public/branding/creator-logo.png",
  );

  // Keep the wordmark and slogan inside the maskable icon's central safe circle.
  const maskable = join(scratch, "maskable.svg");
  const png = (await readFile(charcoal)).toString("base64");
  await writeFile(
    maskable,
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#141414"/><image x="56" y="56" width="400" height="400" href="data:image/png;base64,${png}"/></svg>`,
  );
  const maskOutput = join(scratch, "maskable");
  rasterize(maskable, [512], maskOutput);
  await copyFile(
    join(maskOutput, "512x512.png"),
    "public/icons/maskable-512.png",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
