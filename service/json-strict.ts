// Minimal strict JSON reader for flat objects of scalars, matching CPython's
// json.loads(..., object_pairs_hook=unique_json) outcome for VMess payloads and
// bounded request bodies: duplicate keys rejected, integers kept exact (bigint),
// the 4300-digit int limit enforced, floats/null/nested values rejected.
import { InvalidConfig } from "./text.ts";

export type FlatScalar =
  | { t: "s"; v: string }
  | { t: "i"; v: bigint }
  | { t: "b"; v: boolean };

const fail = (m: string): never => {
  throw new InvalidConfig(m);
};

export function parseFlatJsonObject(text: string): Map<string, FlatScalar> {
  let i = 0;
  const ws = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };
  const str = (): string => {
    if (text[i] !== '"') fail("Expected string");
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail("Unterminated string");
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        return out;
      }
      if (c < 0x20) fail("Invalid control character in string");
      if (c === 92) {
        const e = text[i + 1];
        i += 2;
        switch (e) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\u escape");
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail("Invalid escape");
        }
        continue;
      }
      out += text[i];
      i++;
    }
  };
  const value = (): FlatScalar => {
    const c = text[i];
    if (c === '"') return { t: "s", v: str() };
    if (text.startsWith("true", i)) {
      i += 4;
      return { t: "b", v: true };
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return { t: "b", v: false };
    }
    const m = /^-?(?:0|[1-9][0-9]*)/.exec(text.slice(i, i + 5000));
    if (m) {
      const next = text[i + m[0].length];
      if (next === "." || next === "e" || next === "E")
        fail("Float values are not allowed");
      const digits = m[0].replace("-", "");
      if (digits.length > 4300)
        fail("Exceeds the limit (4300 digits) for integer string conversion");
      i += m[0].length;
      return { t: "i", v: BigInt(m[0]) };
    }
    // null, NaN, Infinity, nested arrays/objects: never valid at this level.
    return fail("Unsupported JSON value");
  };
  const result = new Map<string, FlatScalar>();
  ws();
  if (text[i] !== "{") fail("Expected object");
  i++;
  ws();
  if (text[i] === "}") {
    i++;
  } else {
    for (;;) {
      ws();
      const key = str();
      ws();
      if (text[i] !== ":") fail("Expected ':'");
      i++;
      ws();
      const v = value();
      if (result.has(key)) fail("Duplicate JSON key");
      result.set(key, v);
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        break;
      }
      fail("Expected ',' or '}'");
    }
  }
  ws();
  if (i !== text.length) fail("Extra data");
  return result;
}

/** Python str() of a JSON scalar. */
export function pyStr(v: FlatScalar): string {
  if (v.t === "s") return v.v;
  if (v.t === "i") return v.v.toString();
  return v.v ? "True" : "False";
}
