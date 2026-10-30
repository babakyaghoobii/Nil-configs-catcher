import {
  extractCandidates,
  parseConfig,
  type ParsedConfig,
} from "./protocols.ts";
import { isoSeconds, utf8SigStrict } from "./text.ts";
import {
  CollectorStore,
  type Batch,
  type ConfigRecord,
  type RunReport,
  type SourceReport,
} from "./database.ts";

export const canonicalRoot =
  "https://raw.githubusercontent.com/babakyaghoobii/Nil-configs-catcher/main/";
const token = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/;
const identifier = /^[a-f0-9]{64}$/;
export type Source = {
  id: string;
  name: string;
  owner: string;
  repo: string;
  ref: string;
  path: string;
  fetchUrl: string;
  url: string;
};
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpFailure extends Error {
  code: number;
  retryAfter: number;
  constructor(code: number, message: string, retryAfter = 0) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function validateSources(value: unknown): Source[] {
  if (!value || typeof value !== "object")
    throw new Error("Invalid source manifest");
  const manifest = value as { version?: unknown; sources?: unknown };
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length < 1 ||
    manifest.sources.length > 20
  )
    throw new Error("Invalid source count");
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const raw of manifest.sources) {
    if (
      !raw ||
      typeof raw !== "object" ||
      ["id", "owner", "repo", "ref"].some(
        (key) => typeof raw[key] !== "string" || !token.test(raw[key]),
      )
    )
      throw new Error("Invalid source identity");
    if (seen.has(raw.id)) throw new Error("Duplicate source ID");
    seen.add(raw.id);
    if (
      typeof raw.name !== "string" ||
      raw.name.length < 1 ||
      raw.name.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(raw.name)
    )
      throw new Error("Invalid source name");
    if (
      typeof raw.path !== "string" ||
      raw.path.length > 500 ||
      !raw.path ||
      raw.path
        .split("/")
        .some(
          (part: string) =>
            part === "." || part === ".." || !/^[A-Za-z0-9_.-]+$/.test(part),
        )
    )
      throw new Error("Unsafe source path");
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean")
      throw new Error("Invalid enabled flag");
    if (raw.enabled === false) continue;
    const { id, name, owner, repo, ref, path } = raw;
    sources.push({
      id,
      name,
      owner,
      repo,
      ref,
      path,
      fetchUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
      url: `https://github.com/${owner}/${repo}/blob/${ref}/${path}`,
    });
  }
  if (!sources.length) throw new Error("No enabled source");
  return sources;
}

/** Only code-constructed GitHub raw URLs reach this function; no user URL API. */
export async function readRaw(
  url: string,
  fetcher: Fetcher,
  maximum: number,
  signal: AbortSignal,
): Promise<{ text: string; bytes: number }> {
  const parsed = new URL(url);
  if (
    parsed.href !== url ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "raw.githubusercontent.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+$/.test(
      parsed.pathname,
    )
  )
    throw new Error("Unsafe source URL");
  const response = await fetcher(url, {
    redirect: "manual",
    cache: "no-store",
    signal,
    headers: {
      Accept: "text/plain, application/json",
      "Accept-Encoding": "identity",
      "User-Agent": "NIL-Collector/2.0",
    },
  });
  if (response.status !== 200 || response.redirected)
    throw new Error(`Source HTTP ${response.status}`);
  if (
    ![null, "", "identity"].includes(response.headers.get("Content-Encoding"))
  )
    throw new Error("Compressed source is not allowed");
  if (Number(response.headers.get("Content-Length")) > maximum)
    throw new Error("Source is too large");
  if (!response.body) throw new Error("Empty source response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("Source time budget exhausted");
      const read = reader.read();
      const stopped = new Promise<never>((_, reject) => {
        const abort = () => reject(new Error("Source time budget exhausted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        read
          .finally(() => signal.removeEventListener("abort", abort))
          .catch(() => {});
      });
      const { done, value } = await Promise.race([read, stopped]);
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error("Source is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { text: utf8SigStrict(bytes), bytes: size };
}

function checkReport(value: unknown): RunReport {
  if (!value || typeof value !== "object")
    throw new Error("Invalid upstream report");
  const report = value as RunReport;
  if (
    report.schemaVersion !== 1 ||
    !["success", "partial", "failed", "never"].includes(report.state) ||
    !Number.isSafeInteger(report.totalUnique) ||
    report.totalUnique < 0 ||
    !Number.isSafeInteger(report.added) ||
    report.added < 0 ||
    !Array.isArray(report.sources) ||
    report.sources.length > 20 ||
    !Array.isArray(report.errors) ||
    report.errors.some(
      (message) => typeof message !== "string" || message.length > 500,
    )
  )
    throw new Error("Invalid upstream report");
  return report;
}

export async function ensureInitialized(
  store: CollectorStore,
  fetcher: Fetcher = fetch,
  force = false,
): Promise<void> {
  if (!force && (await store.state("initialized", false))) return;
  const owner = crypto.randomUUID();
  if (!(await store.acquire("bootstrap", owner, Date.now(), force ? 60000 : 0)))
    throw new HttpFailure(
      429,
      "Canonical synchronization is active or cooling down",
      await store.retryAfter("bootstrap", Date.now()),
    );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const paths = [
      "public/data/configs.json",
      "public/data/status.json",
      "public/data/history.json",
      "data/seen.json",
      "sources.json",
    ];
    const documents = await Promise.all(
      paths.map(async (path) =>
        JSON.parse(
          (
            await readRaw(
              canonicalRoot + path,
              fetcher,
              path === "data/seen.json" ? 8 * 1024 * 1024 : 4 * 1024 * 1024,
              controller.signal,
            )
          ).text,
        ),
      ),
    );
    const [snapshot, rawStatus, rawHistory, seen, manifest] = documents;
    const status = checkReport(rawStatus);
    const sources = validateSources(manifest);
    if (
      !snapshot ||
      snapshot.schemaVersion !== 1 ||
      !Array.isArray(snapshot.configs) ||
      snapshot.configs.length > 1000 ||
      snapshot.totalUnique !== status.totalUnique ||
      !Array.isArray(seen) ||
      seen.length > 100000 ||
      seen.length !== status.totalUnique ||
      seen.some((id) => typeof id !== "string" || !identifier.test(id)) ||
      new Set(seen).size !== seen.length ||
      !Array.isArray(rawHistory) ||
      rawHistory.length > 120
    )
      throw new Error("Incoherent upstream snapshot");
    const registry = new Set(seen);
    const records: ConfigRecord[] = [];
    for (const record of snapshot.configs) {
      const parsed = await parseConfig(record?.uri);
      if (
        !registry.has(parsed.id) ||
        ["id", "protocol", "host", "port"].some(
          (key) => parsed[key as keyof ParsedConfig] !== record[key],
        ) ||
        typeof record.firstSeenAt !== "string" ||
        !Number.isFinite(Date.parse(record.firstSeenAt)) ||
        !Array.isArray(record.sources) ||
        record.sources.length < 1 ||
        record.sources.length > 20
      )
        throw new Error("Invalid canonical config metadata");
      for (const source of record.sources) {
        const url = new URL(source.url);
        if (
          !token.test(source.id) ||
          typeof source.name !== "string" ||
          source.name.length > 80 ||
          url.protocol !== "https:" ||
          url.hostname !== "github.com" ||
          url.username ||
          url.password
        )
          throw new Error("Invalid canonical source metadata");
      }
      records.push({
        ...parsed,
        firstSeenAt: record.firstSeenAt,
        sources: record.sources,
      });
    }
    await store.bootstrap(
      records,
      seen,
      { ...status, connectionTested: false },
      rawHistory.map(checkReport),
      {
        version: 1,
        sources: sources.map(
          ({ fetchUrl: _ignored, url: _url, ...source }) => source,
        ),
      },
      owner,
    );
  } catch (error) {
    await store.release("bootstrap", owner);
    if (error instanceof HttpFailure) throw error;
    throw new HttpFailure(
      503,
      "Canonical GitHub initialization is unavailable; prior data was not changed",
      5,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectNow(
  store: CollectorStore,
  limit = 50,
  fetcher: Fetcher = fetch,
): Promise<Batch> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new HttpFailure(400, "Limit must be between 1 and 50");
  await ensureInitialized(store, fetcher);
  const owner = crypto.randomUUID();
  if (!(await store.acquire("collect", owner, Date.now())))
    throw new HttpFailure(
      429,
      "A collection is active or cooling down",
      await store.retryAfter("collect", Date.now()),
    );
  const startedAt = isoSeconds(new Date());
  const previous = (await store.snapshot()).status;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const reports: SourceReport[] = [];
  const selected = new Map<string, ConfigRecord>();
  const cursors = await store.state<Record<string, number>>("cursors", {});
  let invalid = 0,
    duplicates = 0,
    deferred = 0;
  const errors: string[] = [];
  try {
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        (
          await readRaw(
            canonicalRoot + "sources.json",
            fetcher,
            64000,
            controller.signal,
          )
        ).text,
      );
      validateSources(manifest);
      await store.putState("manifest", manifest);
    } catch {
      manifest = await store.state("manifest", null);
      errors.push(
        "Using the last validated source manifest because GitHub manifest refresh failed",
      );
    }
    const sources = validateSources(manifest);
    const batches: {
      source: Source;
      report: SourceReport;
      candidates: string[];
      offset: number;
      visited: number;
    }[] = [];
    let aggregate = 0;
    for (const source of sources) {
      const report: SourceReport = {
        id: source.id,
        name: source.name,
        url: source.url,
        status: "failed",
        candidates: 0,
        valid: 0,
        invalid: 0,
        added: 0,
        error: null,
        scanned: 0,
      };
      reports.push(report);
      try {
        if (controller.signal.aborted || aggregate >= 12 * 1024 * 1024)
          throw new Error("Collection budget exhausted");
        const body = await readRaw(
          source.fetchUrl,
          fetcher,
          Math.min(4 * 1024 * 1024, 12 * 1024 * 1024 - aggregate),
          controller.signal,
        );
        aggregate += body.bytes;
        const candidates = extractCandidates(body.text);
        report.candidates = candidates.length;
        report.status = "success";
        batches.push({
          source,
          report,
          candidates,
          offset:
            Math.max(0, cursors[source.id] || 0) %
            Math.max(1, candidates.length),
          visited: 0,
        });
      } catch {
        report.error = controller.signal.aborted
          ? "Source time budget exhausted"
          : "Source fetch, encoding or size check failed";
      }
    }
    let scanned = 0;
    while (
      selected.size < limit &&
      scanned < 1024 &&
      !controller.signal.aborted
    ) {
      const pending: {
        parsed: ParsedConfig;
        batch: (typeof batches)[number];
      }[] = [];
      let found = false;
      while (pending.length < 64 && scanned < 1024) {
        let progressed = false;
        for (const batch of batches) {
          if (
            batch.visited >= batch.candidates.length ||
            scanned >= 1024 ||
            pending.length >= 64
          )
            continue;
          progressed = true;
          found = true;
          const raw =
            batch.candidates[
              (batch.offset + batch.visited) % batch.candidates.length
            ];
          batch.visited++;
          scanned++;
          batch.report.scanned = (batch.report.scanned || 0) + 1;
          try {
            pending.push({ parsed: await parseConfig(raw), batch });
            batch.report.valid++;
          } catch {
            batch.report.invalid++;
            invalid++;
          }
        }
        if (!progressed || controller.signal.aborted) break;
      }
      if (!found) break;
      const known = await store.seen(pending.map((item) => item.parsed.id));
      for (const { parsed, batch } of pending) {
        const source = {
          id: batch.source.id,
          name: batch.source.name,
          url: batch.source.url,
        };
        const existing = selected.get(parsed.id);
        if (existing) {
          duplicates++;
          if (!existing.sources.some((item) => item.id === source.id))
            existing.sources.push(source);
        } else if (known.has(parsed.id)) duplicates++;
        else if (selected.size < limit)
          selected.set(parsed.id, {
            ...parsed,
            firstSeenAt: startedAt,
            sources: [source],
          });
        else deferred++;
      }
    }
    for (const batch of batches) {
      cursors[batch.source.id] =
        (batch.offset + batch.visited) % Math.max(1, batch.candidates.length);
      deferred += batch.candidates.length - batch.visited;
    }
    if (controller.signal.aborted)
      errors.push(
        "Collection time budget exhausted; only completed validations were retained",
      );
  } catch {
    errors.push(
      "Source collection did not complete; only validated public records can be committed",
    );
  } finally {
    clearTimeout(timeout);
  }
  const successful = reports.filter(
    (source) => source.status === "success",
  ).length;
  const state = !successful
    ? "failed"
    : successful < reports.length || errors.length
      ? "partial"
      : "success";
  const report: RunReport = {
    schemaVersion: 1,
    state,
    startedAt,
    finishedAt: isoSeconds(new Date()),
    lastSuccessfulAt: successful ? startedAt : previous.lastSuccessfulAt,
    added: 0,
    target: limit,
    totalUnique: previous.totalUnique,
    duplicateCount: duplicates,
    invalidCount: invalid,
    scheduleHours: 2,
    snapshotLimit: 1000,
    sources: reports,
    errors,
    connectionTested: false,
    deferredCandidates: deferred,
    origin: "api",
    runId: owner,
  };
  await store.finish(
    owner,
    [...selected.values()],
    report,
    cursors,
    Date.now(),
  );
  return store.snapshot();
}
