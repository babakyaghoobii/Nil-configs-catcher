import { handleCollectorAPI } from "./api.ts";
import { canonicalRoot, readRaw } from "./pipeline.ts";
import type { SqlDatabase } from "./database.ts";

export type WorkerEnv = {
  DB?: SqlDatabase;
  ASSETS: { fetch(request: Request): Promise<Response> };
};

export function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      let response: Response;
      if (url.pathname === "/api/measurements" && ["GET", "HEAD"].includes(request.method)) {
        const { text } = await readRaw(
          canonicalRoot + "public/data/measurements.json",
          fetch,
          32 * 1024,
          AbortSignal.timeout(2500),
        );
        response = new Response(request.method === "HEAD" ? null : text, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60",
          },
        });
      } else if (url.pathname.startsWith("/api/")) {
        response = await handleCollectorAPI(request, env.DB);
      } else if (!["GET", "HEAD"].includes(request.method)) {
        response = new Response("GET or HEAD required", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      } else if (url.pathname === "/robots.txt") {
        response = new Response(
          request.method === "HEAD"
            ? null
            : `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      } else if (url.pathname === "/sitemap.xml") {
        response = new Response(
          request.method === "HEAD"
            ? null
            : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${url.origin}/</loc></url></urlset>`,
          { headers: { "Content-Type": "application/xml; charset=utf-8" } },
        );
      } else {
        response = await env.ASSETS.fetch(request);
        if (
          url.pathname === "/" ||
          url.pathname === "/sw.js" ||
          url.pathname === "/index.html"
        ) {
          const headers = new Headers(response.headers);
          headers.set("Cache-Control", "no-cache");
          if (url.pathname === "/sw.js")
            headers.set("Service-Worker-Allowed", "/");
          response = new Response(response.body, {
            status: response.status,
            headers,
          });
        }
      }
      return secureResponse(response);
    } catch {
      return secureResponse(
        Response.json(
          { error: "NIL service is temporarily unavailable" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
  },
};
