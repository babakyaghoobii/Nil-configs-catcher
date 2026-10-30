// TypeScript port of collector/protocols.py (Nil-configs-catcher, CPython 3.12).
// Identity = SHA-256 of the same canonical JSON the Python reference hashes, so
// records stay deduplicated across the GitHub collector and this service.
// Configs are parsed as data only: no DNS lookup, no connection, no execution.
import { parseFlatJsonObject, pyStr, type FlatScalar } from "./json-strict.ts";
import {
  pyHostname,
  pyIpAddress,
  pyParseQsl,
  pyPort,
  pyUrlsplit,
} from "./pyurl.ts";
import {
  InvalidConfig,
  PY_WHITESPACE,
  cpLen,
  cpSlice,
  decodeBase64,
  hasControl,
  hasLoneSurrogate,
  isPySpace,
  partition,
  pyCompare,
  pyJsonString,
  pyRemoveWhitespace,
  rpartition,
  sha256Hex,
  strictUnquote,
  utf8Strict,
} from "./text.ts";

export { InvalidConfig } from "./text.ts";

export const PROTOCOLS = [
  "vless",
  "vmess",
  "trojan",
  "ss",
  "hysteria2",
  "tuic",
] as const;
export type Protocol = (typeof PROTOCOLS)[number];
export const MAX_URI_LENGTH = 16384;
export const MAX_CANDIDATES = 20000;

export interface ParsedConfig {
  id: string;
  uri: string;
  protocol: Protocol;
  name: string;
  host: string;
  port: number;
}

// re.I in CPython also folds U+017F (ſ) to s and U+0130/U+0131 (İ/ı) to i.
const S = "[sS\u017f]";
const I = "[iI\u0130\u0131]";
const WS_CLASS = PY_WHITESPACE.replace(/[\\\]^-]/g, "\\$&");
const SCHEMES =
  `[vV][lL][eE]${S}${S}|[vV][mM][eE]${S}${S}|[tT][rR][oO][jJ][aA][nN]|${S}${S}|` +
  `[hH][yY]${S}[tT][eE][rR]${I}[aA]2|[hH][yY]2|[tT][uU]${I}[cC]`;
const URI_SOURCE = `(?:${SCHEMES}):\\/\\/[^${WS_CLASS}<>"'\`]+`;
const uriRegex = (flags: string) => new RegExp(URI_SOURCE, flags);

const fail = (m: string): never => {
  throw new InvalidConfig(m);
};

/** collector.protocols.extract_candidates */
export function extractCandidates(input: string): string[] {
  let text = input;
  if (!uriRegex("u").test(text)) {
    try {
      text = utf8Strict(decodeBase64(pyRemoveWhitespace(text)));
    } catch {
      return [];
    }
  }
  const out: string[] = [];
  for (const m of text.matchAll(uriRegex("gu"))) {
    out.push(m[0]);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** collector.protocols.validate_host — IDNA (non-ASCII) names are rejected, see docs. */
export function validateHost(value: unknown): string {
  if (typeof value !== "string" || !value || cpLen(value) > 253)
    fail("Invalid host");
  const v = value as string;
  try {
    return pyIpAddress(v).compressed;
  } catch {
    /* not an IP literal */
  }
  const stripped = v.replace(/\.+$/, "");
  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7f]*$/.test(stripped))
    fail("Unsupported internationalized hostname");
  const labels = stripped.split(".");
  if (stripped) {
    for (const label of labels.slice(0, -1))
      if (!(label.length > 0 && label.length < 64)) fail("Invalid hostname");
    if (labels[labels.length - 1]!.length >= 64) fail("Invalid hostname");
  }
  const host = stripped.toLowerCase();
  if (
    !host ||
    host
      .split(".")
      .some((p) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))
  )
    fail("Invalid hostname");
  if (/^[0-9.]+$/.test(host)) fail("Invalid IPv4 address");
  return host;
}

/** collector.protocols.validate_port; accepts Python str()/int forms. */
export function validatePort(
  value: string | number | bigint | boolean,
): number {
  if (typeof value === "boolean") fail("Invalid port");
  const s = typeof value === "string" ? value : value.toString();
  if (!/^[0-9]{1,5}$/.test(s)) fail("Invalid port");
  const port = parseInt(s, 10);
  if (!(port >= 1 && port <= 65535)) fail("Port out of range");
  return port;
}

export function validateUuid(value: unknown): string {
  if (typeof value !== "string") fail("Invalid UUID");
  if (
    !/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(
      value as string,
    )
  )
    fail("Invalid UUID");
  return (value as string).toLowerCase();
}

function ndDigitValue(cp: number): number {
  let start = cp;
  while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

/** str(x).isdigit() then int(...) for the VMess alterId (Unicode decimal digits). */
function pyIntFromDigits(s: string): number {
  if (!s || !/^\p{Nd}+$/u.test(s)) fail("Invalid alterId");
  if (cpLen(s) > 4300) fail("Invalid alterId");
  let n = 0;
  for (const ch of s) {
    n = n * 10 + ndDigitValue(ch.codePointAt(0)!);
    if (n > 65535) fail("Invalid alterId");
  }
  return n;
}

type CanonValue =
  | { t: "s"; v: string }
  | { t: "i"; v: bigint }
  | { t: "b"; v: boolean };

function dumpsScalar(v: CanonValue): string {
  if (v.t === "s") return pyJsonString(v.v);
  if (v.t === "i") return v.v.toString();
  return v.v ? "true" : "false";
}

/** collector.protocols.parse_config */
export async function parseConfig(uri: unknown): Promise<ParsedConfig> {
  if (typeof uri !== "string" || !uri || cpLen(uri) > MAX_URI_LENGTH)
    fail("Invalid URI length");
  const u = uri as string;
  if (hasLoneSurrogate(u)) fail("Invalid UTF-8");
  for (const c of u)
    if (isPySpace(c) || hasControl(c))
      fail("Whitespace or unsafe separator in URI");
  if (u.includes("\\")) fail("Whitespace or unsafe separator in URI");
  try {
    return await parseInner(u);
  } catch (e) {
    if (e instanceof InvalidConfig) throw e;
    throw new InvalidConfig("Malformed configuration");
  }
}

export async function tryParseConfig(
  uri: unknown,
): Promise<ParsedConfig | null> {
  try {
    return await parseConfig(uri);
  } catch {
    return null;
  }
}

async function parseInner(uri: string): Promise<ParsedConfig> {
  let protocol = uri.split("://", 1)[0]!.toLowerCase();
  if (protocol === "hy2") protocol = "hysteria2";
  if (
    !(PROTOCOLS as readonly string[]).includes(protocol) ||
    !uri.includes("://")
  )
    fail("Unsupported protocol");
  const afterScheme = partition(uri, "://")[2];
  let label = "";
  let host: string;
  let port: number;
  let normalizedBody: string;

  if (protocol === "vmess") {
    const payload = partition(afterScheme, "#")[0];
    const config = parseFlatJsonObject(utf8Strict(decodeBase64(payload)));
    for (const v of config.values())
      if (v.t === "s" && hasControl(v.v))
        fail("Control character in VMess field");
    const ver = config.get("v");
    if (ver && pyStr(ver) !== "2") fail("Unsupported VMess version");
    const add = config.get("add");
    const portValue = config.get("port");
    const idValue = config.get("id");
    if (!add || !portValue || !idValue) fail("Missing VMess field");
    host = validateHost(add!.t === "s" ? add!.v : null);
    port = validatePort(portValue!.v);
    const identifier = validateUuid(idValue!.t === "s" ? idValue!.v : null);
    const ps = config.get("ps");
    label = cpSlice(ps ? pyStr(ps) : "", 160);
    const canonical = new Map<string, CanonValue>();
    for (const [k, v] of config)
      if (k !== "ps") canonical.set(k, v as FlatScalar);
    canonical.set("add", { t: "s", v: host });
    canonical.set("port", { t: "i", v: BigInt(port) });
    canonical.set("id", { t: "s", v: identifier });
    const aid = canonical.get("aid");
    if (aid)
      canonical.set("aid", { t: "i", v: BigInt(pyIntFromDigits(pyStr(aid))) });
    const keys = [...canonical.keys()].sort(pyCompare);
    normalizedBody =
      "{" +
      keys
        .map((k) => `${pyJsonString(k)}:${dumpsScalar(canonical.get(k)!)}`)
        .join(",") +
      "}";
  } else {
    let working = uri;
    if (protocol === "ss" && !partition(uri, "#")[0].includes("@")) {
      const authority = utf8Strict(
        decodeBase64(partition(afterScheme, "#")[0]),
      );
      if (hasControl(authority))
        fail("Control character in Shadowsocks authority");
      working =
        "ss://" +
        authority +
        (uri.includes("#") ? "#" + partition(uri, "#")[2] : "");
    }
    const parts = pyUrlsplit(working);
    host = validateHost(pyHostname(parts.netloc) ?? "");
    const p = pyPort(parts.netloc);
    port = validatePort(p !== null ? p : protocol === "hysteria2" ? 443 : "");
    if (
      (parts.path !== "" && parts.path !== "/") ||
      !parts.netloc.includes("@")
    )
      fail("Invalid authority or path");
    let auth = strictUnquote(rpartition(parts.netloc, "@")[0]);
    if (!auth) fail("Missing credentials");
    if (protocol === "vless") {
      auth = validateUuid(auth);
    } else if (protocol === "tuic") {
      const [identifier, sep, password] = partition(auth, ":");
      if (!sep || !password) fail("Missing TUIC password");
      auth = validateUuid(identifier) + ":" + password;
    } else if (protocol === "ss") {
      if (!auth.includes(":")) auth = utf8Strict(decodeBase64(auth));
      const [method, sep, password] = partition(auth, ":");
      if (!sep || !password || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(method))
        fail("Invalid Shadowsocks credentials");
    }
    if (hasControl(auth)) fail("Control character in credentials");
    strictUnquote(parts.query);
    const query = pyParseQsl(parts.query);
    if (new Set(query.map(([k]) => k)).size !== query.length)
      fail("Duplicate query parameter");
    query.sort((a, b) => pyCompare(a[0], b[0]) || pyCompare(a[1], b[1]));
    label = cpSlice(strictUnquote(parts.fragment), 160);
    normalizedBody =
      `{"auth":${pyJsonString(auth)},"host":${pyJsonString(host)},"port":${port},"query":[` +
      query
        .map(([k, v]) => `[${pyJsonString(k)},${pyJsonString(v)}]`)
        .join(",") +
      "]}";
  }
  if (hasControl(label)) fail("Invalid label");
  // CPython would raise UnicodeEncodeError for lone surrogates when hashing; a
  // lone surrogate in a label cannot be stored as UTF-8 either, so reject both.
  if (hasLoneSurrogate(normalizedBody) || hasLoneSurrogate(label))
    fail("Invalid UTF-8");
  const normalized = protocol + ":" + normalizedBody;
  return {
    id: await sha256Hex(normalized),
    uri,
    protocol: protocol as Protocol,
    name: label || host,
    host,
    port,
  };
}
