const primaryOrigin = "https://nil-config-catcher-babakyaghoobii.lovable.app";
const localPreview =
  ["http:", "https:"].includes(location.protocol) &&
  ["localhost", "127.0.0.1"].includes(location.hostname);
const serviceOrigin =
  import.meta.env.MODE === "hosted" && !localPreview
    ? location.origin
    : primaryOrigin;
export const apiBase = localPreview
  ? new URL(`${import.meta.env.BASE_URL}api/`, location.href).href
  : `${serviceOrigin}/api/`;

export class ServiceError extends Error {
  constructor(
    public status: number,
    public retryAfter = 0,
  ) {
    super(status === 429 ? "Collection is busy" : "Service unavailable");
  }
}

export async function serviceData(collect = false, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), collect ? 40000 : 7000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${apiBase}${collect ? "collect" : "data"}`, {
      method: collect ? "POST" : "GET",
      cache: "no-store",
      signal: controller.signal,
      ...(collect
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 50 }),
          }
        : {}),
    });
    if (!response.ok)
      throw new ServiceError(
        response.status,
        Math.min(
          120,
          Math.max(0, Number(response.headers.get("Retry-After")) || 0),
        ),
      );
    const declared = Number(response.headers.get("Content-Length"));
    if (declared > 8 * 1024 * 1024) throw new Error("Oversized data response");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object")
      throw new Error("Invalid service data");
    const value = data as Record<string, unknown>;
    return [value.snapshot, value.status, value.history];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function subscriptionURL(
  protocol: string,
  source: string,
  query: string,
  format: string,
  title: string,
): string {
  if (
    !["all", "vless", "vmess", "trojan", "ss", "hysteria2", "tuic"].includes(
      protocol,
    )
  )
    throw new Error("Invalid protocol");
  if (
    !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(source) ||
    !["base64", "plain"].includes(format)
  )
    throw new Error("Invalid group");
  if (
    query.length > 200 ||
    title.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(query + title)
  )
    throw new Error("Invalid group text");
  const url = new URL("subscription", `${serviceOrigin}/api/`);
  url.search = new URLSearchParams({
    protocol,
    source,
    q: query,
    format,
    title,
  }).toString();
  return url.href;
}
