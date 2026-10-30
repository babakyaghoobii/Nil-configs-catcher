import { CollectorStore, type SqlDatabase } from "./database.ts";
import {
  collectNow,
  ensureInitialized,
  HttpFailure,
  validateSources,
  type Fetcher,
} from "./pipeline.ts";
import { PROTOCOLS } from "./protocols.ts";
import { encodeBase64, utf8Encode, utf8Strict } from "./text.ts";
import { parseFlatJsonObject } from "./json-strict.ts";

const nativeOrigins = Object.freeze([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "https://babakyaghoobii.github.io",
]);

function query(request: Request, allowed: string[]): URLSearchParams {
  const params = new URL(request.url).searchParams;
  if (
    new Set(params.keys()).size !== [...params.keys()].length ||
    [...params.keys()].some((key) => !allowed.includes(key))
  )
    throw new HttpFailure(400, "Unknown or duplicate query parameter");
  return params;
}

async function bodyLimit(request: Request, maximum = 1024): Promise<string> {
  if (Number(request.headers.get("Content-Length")) > maximum)
    throw new HttpFailure(413, "Request body is too large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HttpFailure(408, "Request body timed out")),
      5000,
    );
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), expired]);
      if (done) break;
      size += value.length;
      if (size > maximum)
        throw new HttpFailure(413, "Request body is too large");
      parts.push(value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      all.set(part, offset);
      offset += part.length;
    }
    return utf8Strict(all);
  } finally {
    clearTimeout(timer!);
    await reader.cancel().catch(() => {});
  }
}

async function collectLimit(
  request: Request,
  allowLimit: boolean,
): Promise<number> {
  const text = await bodyLimit(request);
  if (!text.trim()) return 50;
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new HttpFailure(415, "JSON content type required");
  try {
    const values = parseFlatJsonObject(text);
    if ([...values.keys()].some((key) => !allowLimit || key !== "limit"))
      throw new Error("Unknown option");
    const limit = values.get("limit");
    if (!limit) return 50;
    if (limit.t !== "i" || limit.v < 1n || limit.v > 50n)
      throw new Error("Invalid limit");
    return Number(limit.v);
  } catch {
    throw new HttpFailure(
      400,
      "Only an integer limit from 1 to 50 is accepted",
    );
  }
}

export async function handleCollectorAPI(
  request: Request,
  db: SqlDatabase | undefined,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const origin = request.headers.get("Origin");
  const ownOrigin = new URL(request.url).origin;
  const allowedOrigin =
    !origin || origin === ownOrigin || nativeOrigins.includes(origin);
  const cors =
    origin && allowedOrigin
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
  const respond = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store");
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers,
    });
  };
  try {
    if (
      ![
        "/api/data",
        "/api/collect",
        "/api/subscription",
        "/api/export",
        "/api/sync",
      ].includes(path)
    )
      throw new HttpFailure(404, "Unknown endpoint");
    if (request.method === "OPTIONS") {
      if (!allowedOrigin) throw new HttpFailure(403, "Origin is not allowed");
      return respond(
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
          },
        }),
      );
    }
    if (!db) throw new HttpFailure(503, "Collector storage is not configured");
    const store = new CollectorStore(db);
    if (path === "/api/collect" || path === "/api/sync") {
      if (request.method !== "POST")
        throw new HttpFailure(405, "POST required");
      if (!allowedOrigin) throw new HttpFailure(403, "Origin is not allowed");
      query(request, []);
      const limit = await collectLimit(request, path === "/api/collect");
      if (path === "/api/sync") {
        await ensureInitialized(store, fetcher, true);
        return respond(Response.json(await store.snapshot()));
      }
      return respond(Response.json(await collectNow(store, limit, fetcher)));
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpFailure(405, "GET or HEAD required");
    if (!(await store.state("initialized", false)))
      throw new HttpFailure(503, "Collector initialization is required", 3);
    if (path === "/api/data") {
      query(request, []);
      return respond(Response.json(await store.snapshot()));
    }
    if (path === "/api/export") {
      const params = query(request, ["cursor", "until", "limit"]);
      const current = await store.exportState();
      const integer = (key: string, fallback: number, maximum: number) => {
        const raw = params.get(key);
        if (raw !== null && !/^(0|[1-9][0-9]*)$/.test(raw))
          throw new HttpFailure(400, "Invalid export range");
        const value = raw === null ? fallback : Number(raw);
        if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
          throw new HttpFailure(400, "Invalid export range");
        return value;
      };
      const until = integer("until", current.checkpoint, current.checkpoint);
      const cursor = integer("cursor", 0, until);
      const limit = integer("limit", 100, 200);
      if (!limit) throw new HttpFailure(400, "Invalid export limit");
      return respond(
        Response.json({
          ...(await store.exportPage(cursor, until, limit)),
          datasetId: current.datasetId,
        }),
      );
    }
    const params = query(request, [
      "protocol",
      "source",
      "q",
      "format",
      "title",
    ]);
    const protocol = params.get("protocol") || "all",
      source = params.get("source") || "all",
      format = params.get("format") || "base64";
    const search = params.get("q") || "",
      title = params.get("title") || "NIL";
    if (
      !["all", ...PROTOCOLS].includes(protocol) ||
      !["plain", "base64"].includes(format) ||
      search.length > 200 ||
      title.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(search + title)
    )
      throw new HttpFailure(400, "Invalid subscription filter");
    const sources = validateSources(await store.state("manifest", null));
    if (source !== "all" && !sources.some((item) => item.id === source))
      throw new HttpFailure(400, "Unknown source");
    const data = await store.snapshot();
    const rows = data.snapshot.configs.filter(
      (row) =>
        (protocol === "all" || row.protocol === protocol) &&
        (source === "all" || row.sources.some((item) => item.id === source)) &&
        `${row.name} ${row.host} ${row.sources.map((item) => item.name).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
    const text =
      rows.map((row) => row.uri).join("\n") + (rows.length ? "\n" : "");
    return respond(
      new Response(
        format === "base64" ? encodeBase64(utf8Encode(text)) : text,
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "profile-update-interval": "2",
            "profile-title": `base64:${encodeBase64(utf8Encode(title))}`,
            "X-NIL-Config-Count": String(rows.length),
          },
        },
      ),
    );
  } catch (error) {
    const failure =
      error instanceof HttpFailure
        ? error
        : new HttpFailure(
            503,
            "Collector request could not be completed; existing records were preserved",
          );
    return respond(
      Response.json(
        { error: failure.message },
        {
          status: failure.code,
          headers: failure.retryAfter
            ? { "Retry-After": String(failure.retryAfter) }
            : undefined,
        },
      ),
    );
  }
}
