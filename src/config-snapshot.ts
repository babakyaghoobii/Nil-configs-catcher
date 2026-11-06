const protocols = [
  "vless",
  "vmess",
  "trojan",
  "ss",
  "hysteria2",
  "tuic",
] as const;
type Protocol = (typeof protocols)[number];

export type Source = { id: string; name: string; url: string };
export type Config = {
  id: string;
  uri: string;
  protocol: Protocol;
  name: string;
  host: string;
  port: number;
  firstSeenAt: string;
  sources: Source[];
};
export type Snapshot = {
  schemaVersion: number;
  generatedAt: string | null;
  totalUnique: number;
  configs: Config[];
};
export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid snapshot");
  const data = value as Snapshot;
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.configs) ||
    data.configs.length > 1000
  )
    throw new Error("Invalid snapshot");
  for (const item of data.configs) {
    if (
      !item ||
      !/^[a-f0-9]{64}$/.test(item.id) ||
      !protocols.includes(item.protocol) ||
      typeof item.uri !== "string" ||
      item.uri.length > 16384 ||
      !/^(vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\//i.test(item.uri) ||
      typeof item.name !== "string" ||
      typeof item.host !== "string" ||
      !Number.isInteger(item.port) ||
      item.port < 1 ||
      item.port > 65535 ||
      Number.isNaN(Date.parse(item.firstSeenAt)) ||
      !Array.isArray(item.sources) ||
      item.sources.some(
        (source) =>
          !source ||
          typeof source.name !== "string" ||
          typeof source.url !== "string",
      )
    )
      throw new Error("Invalid record");
  }
  return data;
}
