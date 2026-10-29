import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const input = "public/icons/icon-512.png";
if (!existsSync("assets/branding/nil-logo-charcoal.png") || !existsSync(input))
  throw new Error(
    "The supplied NIL logo is required. Run npm run icons first.",
  );
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@tauri-apps/cli/tauri.js",
    "icon",
    input,
    "--fit",
    "contain",
    "--output",
    "src-tauri/icons",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
const keep = new Set([
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.icns",
  "icon.ico",
]);
for (const name of await readdir("src-tauri/icons")) {
  if (!keep.has(name))
    await rm(join("src-tauri/icons", name), { recursive: true, force: true });
}
