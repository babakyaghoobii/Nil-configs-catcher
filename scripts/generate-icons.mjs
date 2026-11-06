// Derive platform icon raster assets from the APPROVED official NIL 04 Blue Peach vector.
// No creative redraw, no old charcoal wordmark.
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const official = "public/branding/nil-04-blue-peach.svg";
const scratch = await mkdtemp(join(tmpdir(), "nil-04-icons-"));
const cli = "node_modules/@tauri-apps/cli/tauri.js";
function rasterize(input, sizes, output) {
  const args = [cli, "icon", input, "--output", output];
  for (const size of sizes) args.push("--png", String(size));
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Official NIL 04 icon rasterization failed");
}
try {
  await mkdir("public/icons", {recursive:true});
  const out = join(scratch,"icons");
  rasterize(official, [32,180,192,512,640], out);
  for (const [size, name] of [
    [32,"favicon-32.png"],
    [180,"apple-touch-icon.png"],
    [192,"icon-192.png"],
    [512,"icon-512.png"],
    [512,"maskable-512.png"],
  ]) await copyFile(join(out,`${size}x${size}.png`),`public/icons/${name}`);
} finally {
  await rm(scratch,{recursive:true,force:true});
}
