/** Stable imported profile names. Global number comes from immutable D1 seq. */
import { decodeBase64, encodeBase64, utf8Encode, utf8Strict } from "./text.ts";

const short: Record<string, string> = {
  hysteria2: "h2", hy2: "h2", vless: "vlss",
  vmess: "vm", trojan: "tr", ss: "ss", tuic: "tuic",
};
export function babakName(protocol: string, sequence: number): string {
  const alias = short[protocol.toLowerCase()];
  if (!alias || !Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error("Invalid protocol or sequence");
  const digits = String(sequence).padStart(6, "0");
  return `Babak-${alias}-${digits.match(/.{1,2}/g)!.join("-")}`;
}
export function renameForClient<T extends { uri: string; protocol: string; name: string }>(
  record: T, sequence: number,
): T {
  const name = babakName(record.protocol, sequence);
  let uri: string;
  if (record.protocol === "vmess") {
    const body = record.uri.slice(record.uri.indexOf("://") + 3).split("#", 1)[0]!;
    const data = JSON.parse(utf8Strict(decodeBase64(body))) as Record<string, unknown>;
    data.ps = name;
    uri = "vmess://" + encodeBase64(utf8Encode(JSON.stringify(data)));
  } else {
    uri = record.uri.split("#", 1)[0] + "#" + encodeURIComponent(name);
  }
  return { ...record, name, uri };
}
