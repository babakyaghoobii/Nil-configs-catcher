// Faithful ports of the CPython 3.12 stdlib pieces used by the reference parser:
// ipaddress.ip_address(...).compressed, urllib.parse.urlsplit (+hostname/port)
// and urllib.parse.parse_qsl(keep_blank_values=True, errors="strict", max_num_fields=100).
// Pure string processing only: nothing here resolves or contacts a host.
import {
  InvalidConfig,
  cpLen,
  partition,
  pyUnquote,
  rpartition,
} from "./text.ts";

const fail = (m: string): never => {
  throw new InvalidConfig(m);
};

function pySplitMax(s: string, sep: string, maxsplit: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (out.length < maxsplit) {
    const i = rest.indexOf(sep);
    if (i < 0) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

function parseIPv4(s: string): number[] {
  if (!s) fail("Address cannot be empty");
  if (s.includes("/")) fail("Unexpected '/'");
  const octets = s.split(".");
  if (octets.length !== 4) fail("Expected 4 octets");
  return octets.map((o) => {
    if (!o) fail("Empty octet");
    if (!/^[0-9]+$/.test(o)) fail("Only decimal digits permitted");
    if (o.length > 3) fail("At most 3 characters");
    if (o !== "0" && o[0] === "0") fail("Leading zeros are not permitted");
    const v = parseInt(o, 10);
    if (v > 255) fail("Octet exceeds 255");
    return v;
  });
}

function parseHextet(h: string): number {
  if (!/^[0-9a-fA-F]*$/.test(h)) fail("Only hex digits permitted");
  if (h.length > 4) fail("At most 4 characters");
  if (h.length === 0) fail("invalid literal for int()");
  return parseInt(h, 16);
}

function parseIPv6(input: string): { hextets: number[]; scope: string | null } {
  if (input.includes("/")) fail("Unexpected '/'");
  const [addr, sep, scope] = partition(input, "%");
  if (sep && (!scope || scope.includes("%"))) fail("Invalid IPv6 scope");
  if (!addr) fail("Address cannot be empty");
  if (cpLen(addr) > 45) fail("At most 45 characters expected");
  const parts = pySplitMax(addr, ":", 9);
  if (parts.length < 3) fail("At least 3 parts expected");
  if (parts[parts.length - 1]!.includes(".")) {
    const v4 = parseIPv4(parts.pop()!);
    parts.push(((v4[0]! << 8) | v4[1]!).toString(16));
    parts.push(((v4[2]! << 8) | v4[3]!).toString(16));
  }
  if (parts.length > 9) fail("At most 8 colons permitted");
  let skip: number | null = null;
  for (let i = 1; i < parts.length - 1; i++) {
    if (!parts[i]) {
      if (skip !== null) fail("At most one '::' permitted");
      skip = i;
    }
  }
  let hi: number;
  let lo: number;
  let skipped: number;
  if (skip !== null) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0]) {
      hi -= 1;
      if (hi) fail("Leading ':' only permitted as part of '::'");
    }
    if (!parts[parts.length - 1]) {
      lo -= 1;
      if (lo) fail("Trailing ':' only permitted as part of '::'");
    }
    skipped = 8 - (hi + lo);
    if (skipped < 1) fail("Expected at most 7 other parts with '::'");
  } else {
    if (parts.length !== 8) fail("Exactly 8 parts expected without '::'");
    if (!parts[0]) fail("Leading ':' only permitted as part of '::'");
    if (!parts[parts.length - 1])
      fail("Trailing ':' only permitted as part of '::'");
    hi = parts.length;
    lo = 0;
    skipped = 0;
  }
  const hextets: number[] = [];
  for (let i = 0; i < hi; i++) hextets.push(parseHextet(parts[i]!));
  for (let i = 0; i < skipped; i++) hextets.push(0);
  for (let i = parts.length - lo; i < parts.length; i++)
    hextets.push(parseHextet(parts[i]!));
  return { hextets, scope: sep ? scope : null };
}

function compressHextets(values: number[]): string {
  let hextets = values.map((v) => v.toString(16));
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  let len = 0;
  hextets.forEach((h, i) => {
    if (h === "0") {
      len += 1;
      if (start === -1) start = i;
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
    } else {
      len = 0;
      start = -1;
    }
  });
  if (bestLen > 1) {
    const end = bestStart + bestLen;
    if (end === hextets.length) hextets = [...hextets, ""];
    hextets = [...hextets.slice(0, bestStart), "", ...hextets.slice(end)];
    if (bestStart === 0) hextets = ["", ...hextets];
  }
  return hextets.join(":");
}

export interface PyIp {
  version: 4 | 6;
  compressed: string;
}

/** ipaddress.ip_address(value) — throws InvalidConfig where CPython raises ValueError. */
export function pyIpAddress(value: string): PyIp {
  try {
    return { version: 4, compressed: parseIPv4(value).join(".") };
  } catch {
    /* fall through to IPv6 like ip_address() */
  }
  const { hextets, scope } = parseIPv6(value);
  let text: string;
  const mapped =
    hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
  if (mapped) {
    const a = hextets[6]!;
    const b = hextets[7]!;
    text = `::ffff:${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  } else {
    text = compressHextets(hextets);
  }
  return { version: 6, compressed: scope ? `${text}%${scope}` : text };
}

export interface PySplit {
  netloc: string;
  path: string;
  query: string;
  fragment: string;
}

const SCHEME_CHARS = /^[A-Za-z0-9+\-.]$/;

function checkBracketedHost(hostname: string): void {
  if (hostname.startsWith("v")) {
    if (!/^v[a-fA-F0-9]+\..+$/su.test(hostname) || hostname.includes("\n"))
      fail("IPvFuture address is invalid");
  } else {
    const ip = pyIpAddress(hostname);
    if (ip.version === 4) fail("An IPv4 address cannot be in brackets");
  }
}

function checkBracketedNetloc(netloc: string): void {
  const hostAndPort = rpartition(netloc, "@")[2];
  const [before, open, bracketed] = partition(hostAndPort, "[");
  let hostname: string;
  if (open) {
    if (before) fail("Invalid IPv6 URL");
    const [h, , port] = partition(bracketed, "]");
    if (port && !port.startsWith(":")) fail("Invalid IPv6 URL");
    hostname = h;
  } else {
    hostname = partition(hostAndPort, ":")[0];
  }
  checkBracketedHost(hostname);
}

function checkNetloc(netloc: string): void {
  // eslint-disable-next-line no-control-regex
  if (!netloc || /^[\x00-\x7f]*$/.test(netloc)) return;
  const n = netloc.replace(/[@:#?]/g, "");
  const n2 = n.normalize("NFKC");
  if (n === n2) return;
  for (const c of "/?#@:")
    if (n2.includes(c))
      fail("netloc contains invalid characters under NFKC normalization");
}

/** urllib.parse.urlsplit(url) on CPython 3.12. */
export function pyUrlsplit(input: string): PySplit {
  // eslint-disable-next-line no-control-regex
  let url = input.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
  let netloc = "";
  let query = "";
  let fragment = "";
  const i = url.indexOf(":");
  if (i > 0 && /^[A-Za-z]/.test(url)) {
    let ok = true;
    for (const c of url.slice(0, i)) if (!SCHEME_CHARS.test(c)) ok = false;
    if (ok) url = url.slice(i + 1);
  }
  if (url.startsWith("//")) {
    let delim = url.length;
    for (const c of "/?#") {
      const w = url.indexOf(c, 2);
      if (w >= 0) delim = Math.min(delim, w);
    }
    netloc = url.slice(2, delim);
    url = url.slice(delim);
    const open = netloc.includes("[");
    const close = netloc.includes("]");
    if (open !== close) fail("Invalid IPv6 URL");
    if (open && close) checkBracketedNetloc(netloc);
  }
  if (url.includes("#")) [url, , fragment] = partition(url, "#");
  if (url.includes("?")) [url, , query] = partition(url, "?");
  checkNetloc(netloc);
  return { netloc, path: url, query, fragment };
}

function hostinfo(netloc: string): [string, string | null] {
  const info = rpartition(netloc, "@")[2];
  const [, open, bracketed] = partition(info, "[");
  let hostname: string;
  let port: string;
  if (open) {
    let rest: string;
    [hostname, , rest] = partition(bracketed, "]");
    port = partition(rest, ":")[2];
  } else {
    [hostname, , port] = partition(info, ":");
  }
  return [hostname, port ? port : null];
}

/** SplitResult.hostname */
export function pyHostname(netloc: string): string | null {
  const h = hostinfo(netloc)[0];
  if (!h) return null;
  const [name, pct, zone] = partition(h, "%");
  return name.toLowerCase() + pct + zone;
}

/** SplitResult.port (int, None, or ValueError). */
export function pyPort(netloc: string): number | null {
  const p = hostinfo(netloc)[1];
  if (p === null) return null;
  if (!/^[0-9]+$/.test(p)) fail("Port could not be cast to integer value");
  if (p.length > 4300) fail("Exceeds the limit for integer string conversion");
  const digits = p.replace(/^0+(?=\d)/, "");
  if (digits.length > 5 || Number(digits) > 65535)
    fail("Port out of range 0-65535");
  return Number(digits);
}

/** parse_qsl(qs, keep_blank_values=True, encoding="utf-8", errors="strict", max_num_fields=100) */
export function pyParseQsl(qs: string): Array<[string, string]> {
  if (!qs) return [];
  const fields = 1 + (qs.match(/&/g)?.length ?? 0);
  if (fields > 100) fail("Max number of fields exceeded");
  const out: Array<[string, string]> = [];
  for (const nv of qs.split("&")) {
    if (!nv) continue;
    const [name, , value] = partition(nv, "=");
    out.push([
      pyUnquote(name.replace(/\+/g, " ")),
      pyUnquote(value.replace(/\+/g, " ")),
    ]);
  }
  return out;
}
