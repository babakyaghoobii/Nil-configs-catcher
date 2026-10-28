import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const candidate = [
  "public/branding/creator-logo.png",
  "public/branding/creator-logo.svg",
].find(existsSync);
const input = candidate || "public/icons/icon-512.png";
if (!candidate)
  console.log(
    "Draft build: using the existing NIL icon until the creator supplies their logo.",
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
