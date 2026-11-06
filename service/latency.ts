import { CollectorStore, type SqlDatabase } from "./database.ts";

type Socket = {
  opened: Promise<unknown>;
  close(): Promise<void>;
  closed: Promise<void>;
};
type Dial = (address: { hostname: string; port: number }) => Socket;
type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};
export type LatencyEnv = { DB?: SqlDatabase; LATENCY_LIMITER?: RateLimiter };

function publicIPv4(value: string): boolean {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  const octets = value.split(".").map(Number);
  const [a, b, c] = octets;
  return (
    octets.every((octet) => octet <= 255) &&
    !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && [0, 2].includes(c)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  );
}

async function resolvePublicIPv4(host: string, fetcher: typeof fetch) {
  if (/^[\d.]+$/.test(host)) return publicIPv4(host) ? host : null;
  if (
    !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,62}$/i.test(host)
  )
    return null;
  const dns = new URL("https://cloudflare-dns.com/dns-query");
  dns.search = new URLSearchParams({ name: host, type: "A" }).toString();
  const response = await fetcher(dns, {
    headers: { Accept: "application/dns-json" },
    redirect: "error",
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error("Resolver unavailable");
  const result = (await response.json()) as {
    Status?: number;
    Answer?: { type: number; data: string }[];
  };
  const addresses = (result.Answer ?? [])
    .filter(({ type }) => type === 1)
    .map(({ data }) => data);
  return result.Status === 0 && addresses.length && addresses.every(publicIPv4)
    ? addresses[0]
    : null;
}

export async function latency(
  request: Request,
  env: LatencyEnv,
  dial: Dial,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowed =
    !origin ||
    origin === url.origin ||
    origin === "https://babakyaghoobii.github.io";
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin && allowed) headers.set("Access-Control-Allow-Origin", origin);
  const respond = (state: string, status = 200, latencyMs?: number) =>
    Response.json(
      { state, ...(latencyMs === undefined ? {} : { latencyMs }) },
      { status, headers },
    );
  if (!allowed) return respond("forbidden", 403);
  if (request.method !== "POST") {
    headers.set("Allow", "POST");
    return respond("method", 405);
  }
  const id = url.searchParams.get("id") ?? "";
  if (url.searchParams.size !== 1 || !/^[a-f0-9]{64}$/.test(id) || request.body)
    return respond("invalid", 400);
  const client = request.headers.get("CF-Connecting-IP");
  if (!client || !env.DB || !env.LATENCY_LIMITER)
    return respond("unavailable", 503);
  const limiter = env.LATENCY_LIMITER;
  try {
    if (
      !(await limiter.limit({ key: `client:${client}` })).success ||
      !(await limiter.limit({ key: `config:${id}` })).success
    )
      return respond("limited", 429);
    const record = await new CollectorStore(env.DB).record(id);
    if (!record) return respond("missing", 404);
    if (["hysteria2", "tuic"].includes(record.protocol) || record.port === 25)
      return respond("unsupported");
    const ip = await resolvePublicIPv4(record.host, fetcher);
    if (!ip) return respond("unsupported");
    if (
      !(await limiter.limit({ key: `endpoint:${ip}:${record.port}` })).success
    )
      return respond("limited", 429);
    let socket: Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const start = performance.now();
      socket = dial({ hostname: ip, port: record.port });
      void socket.closed.catch(() => {});
      await Promise.race([
        socket.opened,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("TCP timeout")), 5000);
        }),
      ]);
      return respond(
        "open",
        200,
        Math.max(1, Math.round(performance.now() - start)),
      );
    } catch {
      return respond("failed");
    } finally {
      clearTimeout(timer);
      if (socket) void socket.close().catch(() => {});
    }
  } catch {
    return respond("unavailable", 503);
  }
}
