// Small, dependency-free helpers that reproduce CPython 3.12 string semantics
// the reference collector relies on (code-point lengths, str.isspace, strict
// UTF-8, base64 with validate=True). Runtime-neutral: Workers, Node, Deno, browsers.

export class InvalidConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfig";
  }
}

/** Exactly the code points for which CPython's str.isspace() (and re `\s`) is true. */
export const PY_WHITESPACE =
  "\t\n\u000b\u000c\r\u001c\u001d\u001e\u001f \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";
const PY_WS_SET = new Set(Array.from(PY_WHITESPACE));

export function isPySpace(ch: string): boolean {
  return PY_WS_SET.has(ch);
}

export function isControl(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c < 32 || c === 127;
}

export function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        i++;
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/** len(str) in Python: number of code points. */
export function cpLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** s[:n] in Python (code points). */
export function cpSlice(s: string, n: number): string {
  if (s.length <= n) return s;
  return Array.from(s).slice(0, n).join("");
}

/** Python code-point ordering for sorted()/sort_keys. */
export function pyCompare(a: string, b: string): number {
  const A = Array.from(a);
  const B = Array.from(b);
  const len = Math.min(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const x = A[i]!.codePointAt(0)!;
    const y = B[i]!.codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return A.length === B.length ? 0 : A.length < B.length ? -1 : 1;
}

/** "".join(text.split()) */
export function pyRemoveWhitespace(s: string): string {
  let out = "";
  for (const ch of s) if (!PY_WS_SET.has(ch)) out += ch;
  return out;
}

const fatalUtf8 = () =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** bytes.decode("utf-8") — strict, keeps a leading BOM like CPython. */
export function utf8Strict(bytes: Uint8Array): string {
  try {
    return fatalUtf8().decode(bytes);
  } catch {
    throw new InvalidConfig("Invalid UTF-8");
  }
}

/** bytes.decode("utf-8-sig") — strict, strips one leading BOM. */
export function utf8SigStrict(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function utf8Encode(s: string): Uint8Array {
  if (hasLoneSurrogate(s)) throw new InvalidConfig("Invalid UTF-8");
  return new TextEncoder().encode(s);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/**
 * Port of collector.protocols.decode_base64 on CPython 3.12:
 * b64decode(value + pad, altchars=b"-_", validate=True) uses binascii strict mode
 * (no leading/excess padding, no 4n+1 data length; trailing bits are ignored).
 */
export function decodeBase64(value: string): Uint8Array {
  if (!value || cpLen(value) > 6_000_000)
    throw new InvalidConfig("Invalid base64 length");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value))
    throw new InvalidConfig("Invalid base64 alphabet");
  const data = value.replace(/=+$/, "");
  const given = value.length - data.length;
  const needed = (4 - (data.length % 4)) % 4;
  if (!data.length || data.length % 4 === 1 || given > needed)
    throw new InvalidConfig("Invalid base64");
  const out = new Uint8Array(Math.floor((data.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < data.length; i++) {
    let c = data.charCodeAt(i);
    if (c === 45)
      c = 43; // '-' -> '+'
    else if (c === 95) c = 47; // '_' -> '/'
    const v = B64_INDEX[c]!;
    if (v < 0) throw new InvalidConfig("Invalid base64");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  return out.subarray(0, o);
}

export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=";
    out += i + 2 < bytes.length ? B64[n & 63]! : "=";
  }
  return out;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8Encode(s) as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** JSON string literal identical to json.dumps(s, ensure_ascii=False) for well-formed strings. */
export function pyJsonString(s: string): string {
  if (hasLoneSurrogate(s)) throw new InvalidConfig("Invalid UTF-8");
  return JSON.stringify(s);
}

/** Percent-decoding identical to urllib.parse.unquote(s, errors="strict"). */
export function pyUnquote(s: string): string {
  if (!s.includes("%")) return s;
  let out = "";
  const re = /[\x00-\x7f]+/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    out += s.slice(last, m.index);
    out += utf8Strict(unquoteToBytes(m[0]));
    last = m.index! + m[0].length;
  }
  return out + s.slice(last);
}

function unquoteToBytes(ascii: string): Uint8Array {
  const bytes: number[] = [];
  const parts = ascii.split("%");
  const push = (t: string) => {
    for (let i = 0; i < t.length; i++) bytes.push(t.charCodeAt(i));
  };
  push(parts[0]!);
  for (const item of parts.slice(1)) {
    const hex = item.slice(0, 2);
    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      push(item.slice(2));
    } else {
      bytes.push(37);
      push(item);
    }
  }
  return Uint8Array.from(bytes);
}

/** collector.protocols.strict_unquote */
export function strictUnquote(value: string): string {
  if (/%(?![0-9a-fA-F]{2})/.test(value))
    throw new InvalidConfig("Malformed percent encoding");
  const result = pyUnquote(value);
  if (hasControl(result)) throw new InvalidConfig("Control character");
  return result;
}

/** Python str.partition */
export function partition(s: string, sep: string): [string, string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}

/** Python str.rpartition */
export function rpartition(s: string, sep: string): [string, string, string] {
  const i = s.lastIndexOf(sep);
  return i < 0 ? ["", "", s] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}

export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const ISO_SECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
