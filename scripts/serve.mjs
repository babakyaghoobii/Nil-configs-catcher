// Local verification server mounts dist at the same subpath as GitHub Pages.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const defaultPrefix = "/Nil-configs-catcher/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
export function createPreviewServer(
  directory = "dist",
  prefix = defaultPrefix,
) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (pathname === "/" && prefix !== "/") {
        response.writeHead(302, { Location: prefix });
        response.end();
        return;
      }
      if (!pathname.startsWith(prefix)) throw new Error("Not found");
      const path = resolve(root, pathname.slice(prefix.length) || "index.html");
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile())
        throw new Error("Not found");
      response.writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(
        request.method === "HEAD" ? undefined : await readFile(path),
      );
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const desktop = process.argv.includes("--desktop");
  const hosted = process.argv.includes("--hosted");
  const port = desktop ? 4174 : hosted ? 4175 : 4173;
  const prefix = hosted ? "/" : defaultPrefix;
  createPreviewServer(
    desktop ? "dist-desktop" : hosted ? "dist-hosted" : "dist",
    prefix,
  ).listen(port, "0.0.0.0", () =>
    console.log(`NIL preview: http://localhost:${port}${prefix}`),
  );
}
