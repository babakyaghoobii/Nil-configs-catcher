// Local verification server mounts dist at the same subpath as GitHub Pages.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve("dist");
const prefix = "/Nil-configs-catcher/";
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
export function createPreviewServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (pathname === "/") {
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
  createPreviewServer().listen(4173, "0.0.0.0", () =>
    console.log("NIL preview: http://localhost:4173" + prefix),
  );
}
