import type { ParsedConfig } from "./protocols.ts";

export type SourceRef = { id: string; name: string; url: string };
export type ConfigRecord = ParsedConfig & {
  firstSeenAt: string;
  sources: SourceRef[];
};
export type SourceReport = SourceRef & {
  status: string;
  candidates: number;
  valid: number;
  invalid: number;
  added: number;
  error: string | null;
  scanned?: number;
};
export type RunReport = {
  schemaVersion: 1;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessfulAt: string | null;
  added: number;
  target: number;
  totalUnique: number;
  duplicateCount: number;
  invalidCount: number;
  scheduleHours: number;
  snapshotLimit: number;
  sources: SourceReport[];
  errors: string[];
  connectionTested: false;
  deferredCandidates?: number;
  origin?: string;
  runId?: string;
};
export type Batch = {
  snapshot: {
    schemaVersion: 1;
    generatedAt: string | null;
    totalUnique: number;
    configs: ConfigRecord[];
  };
  status: RunReport;
  history: RunReport[];
  checkpoint: number;
  datasetId: string;
};

export interface SqlResult<T = Record<string, unknown>> {
  results: T[];
  meta?: { changes?: number };
}
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<SqlResult>;
}
export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch<T = Record<string, unknown>>(
    statements: SqlStatement[],
  ): Promise<SqlResult<T>[]>;
}

const emptyReport = (): RunReport => ({
  schemaVersion: 1,
  state: "never",
  startedAt: null,
  finishedAt: null,
  lastSuccessfulAt: null,
  added: 0,
  target: 50,
  totalUnique: 0,
  duplicateCount: 0,
  invalidCount: 0,
  scheduleHours: 2,
  snapshotLimit: 1000,
  sources: [],
  errors: [],
  connectionTested: false,
});

/** One instance per request; D1 holds all persistent state and atomic leases. */
export class CollectorStore {
  readonly db: SqlDatabase;
  constructor(db: SqlDatabase) {
    this.db = db;
  }
  private statement(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).bind(...params);
  }

  async state<T>(key: string, fallback: T): Promise<T> {
    const row = await this.statement(
      "SELECT value FROM nil_state WHERE key = ?",
      key,
    ).first<{ value: string }>();
    return row ? (JSON.parse(row.value) as T) : fallback;
  }
  async putState(key: string, value: unknown) {
    await this.statement(
      "INSERT INTO nil_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    ).run();
  }

  async acquire(
    name: "bootstrap" | "collect",
    owner: string,
    now: number,
    cooldown = 60000,
  ): Promise<boolean> {
    const row = await this.statement(
      "UPDATE nil_locks SET owner=?, expires_at=?, next_at=? WHERE name=? AND expires_at<=? AND next_at<=? RETURNING owner",
      owner,
      now + 90000,
      now + cooldown,
      name,
      now,
      now,
    ).first<{ owner: string }>();
    return row?.owner === owner;
  }
  async retryAfter(name: string, now: number): Promise<number> {
    const row = await this.statement(
      "SELECT max(expires_at,next_at) AS until FROM nil_locks WHERE name=?",
      name,
    ).first<{ until: number }>();
    return Math.max(
      1,
      Math.min(90, Math.ceil(((row?.until || now) - now) / 1000)),
    );
  }
  async release(name: string, owner: string) {
    await this.statement(
      "UPDATE nil_locks SET owner=NULL,expires_at=0 WHERE name=? AND owner=?",
      name,
      owner,
    ).run();
  }

  /** Called only during first deployment bootstrap, under its database lease. */
  async bootstrap(
    records: ConfigRecord[],
    seen: string[],
    status: RunReport,
    history: RunReport[],
    sources: unknown,
    owner: string,
  ) {
    const statements: SqlStatement[] = [];
    const guard =
      "EXISTS(SELECT 1 FROM nil_locks WHERE name='bootstrap' AND owner=?)";
    // JSON bind payloads stay below D1's per-value limit. All statements commit atomically.
    for (let offset = 0; offset < records.length; offset += 50) {
      const rows = JSON.stringify(records.slice(offset, offset + 50));
      statements.push(
        this.statement(
          `INSERT OR IGNORE INTO nil_configs(id,record,first_seen) SELECT json_extract(value,'$.id'),json(value),json_extract(value,'$.firstSeenAt') FROM json_each(?) WHERE ${guard}`,
          rows,
          owner,
        ),
      );
    }
    for (let offset = 0; offset < seen.length; offset += 10000)
      statements.push(
        this.statement(
          `INSERT OR IGNORE INTO nil_seen(id) SELECT value FROM json_each(?) WHERE ${guard}`,
          JSON.stringify(seen.slice(offset, offset + 10000)),
          owner,
        ),
      );
    statements.push(
      this.statement(
        `INSERT OR IGNORE INTO nil_runs(id,report,started_at) SELECT coalesce(json_extract(value,'$.runId'),'github:'||json_extract(value,'$.startedAt')),json(value),coalesce(json_extract(value,'$.startedAt'),'') FROM json_each(?) WHERE ${guard}`,
        JSON.stringify(history),
        owner,
      ),
    );
    statements.push(
      this.statement(
        `INSERT INTO nil_state(key,value) SELECT 'latest',? WHERE ${guard} ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE coalesce(json_extract(excluded.value,'$.startedAt'),'')>coalesce(json_extract(nil_state.value,'$.startedAt'),'')`,
        JSON.stringify(status),
        owner,
      ),
    );
    statements.push(
      this.statement(
        `INSERT OR IGNORE INTO nil_state(key,value) SELECT 'dataset_id',? WHERE ${guard}`,
        JSON.stringify(crypto.randomUUID()),
        owner,
      ),
    );
    for (const [key, value] of Object.entries({
      initialized: true,
      manifest: sources,
    }))
      statements.push(
        this.statement(
          `INSERT INTO nil_state(key,value) SELECT ?,? WHERE ${guard} ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          key,
          JSON.stringify(value),
          owner,
        ),
      );
    statements.push(
      this.statement(
        "UPDATE nil_locks SET owner=NULL,expires_at=0 WHERE name='bootstrap' AND owner=?",
        owner,
      ),
    );
    await this.db.batch(statements);
    if (!(await this.state("initialized", false)))
      throw new Error("Bootstrap lease was lost");
  }

  async seen(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const result = await this.statement(
      "SELECT id FROM nil_seen WHERE id IN (SELECT value FROM json_each(?))",
      JSON.stringify(ids),
    ).all<{ id: string }>();
    return new Set(result.results.map((row) => row.id));
  }

  /** The lease gates EVERY write; expired or superseded workers cannot commit. */
  async finish(
    owner: string,
    records: ConfigRecord[],
    report: RunReport,
    cursors: Record<string, number>,
    now: number,
  ): Promise<RunReport> {
    const guard =
      "EXISTS(SELECT 1 FROM nil_locks WHERE name='collect' AND owner=? AND expires_at>?)";
    const rows = JSON.stringify(records);
    const statements = [
      this.statement(
        `INSERT OR IGNORE INTO nil_configs(id,record,first_seen,run_id) SELECT json_extract(value,'$.id'),json(value),json_extract(value,'$.firstSeenAt'),? FROM json_each(?) WHERE NOT EXISTS(SELECT 1 FROM nil_seen WHERE id=json_extract(value,'$.id')) AND ${guard}`,
        owner,
        rows,
        owner,
        now,
      ),
      this.statement(
        `INSERT OR IGNORE INTO nil_seen(id) SELECT json_extract(value,'$.id') FROM json_each(?) WHERE ${guard}`,
        rows,
        owner,
        now,
      ),
      this.statement(
        `INSERT INTO nil_runs(id,report,started_at) SELECT ?,json_set(?, '$.added',(SELECT count(*) FROM nil_configs WHERE run_id=?),'$.totalUnique',(SELECT total FROM nil_totals WHERE singleton=1),'$.sources',json((SELECT json_group_array(json_set(s.value,'$.added',(SELECT count(*) FROM nil_configs AS c WHERE c.run_id=? AND json_extract(c.record,'$.sources[0].id')=json_extract(s.value,'$.id')))) FROM json_each(?,'$.sources') AS s))),? WHERE ${guard}`,
        owner,
        JSON.stringify(report),
        owner,
        owner,
        JSON.stringify(report),
        report.startedAt || "",
        owner,
        now,
      ),
      this.statement(
        `INSERT INTO nil_state(key,value) SELECT 'latest',report FROM nil_runs WHERE id=? AND ${guard} ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        owner,
        owner,
        now,
      ),
      this.statement(
        `INSERT INTO nil_state(key,value) SELECT 'cursors',? WHERE ${guard} ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        JSON.stringify(cursors),
        owner,
        now,
      ),
      this.statement(
        "UPDATE nil_locks SET owner=NULL,expires_at=0 WHERE name='collect' AND owner=?",
        owner,
      ),
    ];
    await this.db.batch(statements);
    const row = await this.statement(
      "SELECT report FROM nil_runs WHERE id=?",
      owner,
    ).first<{ report: string }>();
    if (!row)
      throw new Error("Collection lease expired; stale results were discarded");
    return JSON.parse(row.report) as RunReport;
  }

  async snapshot(): Promise<Batch> {
    const results = await this.db.batch([
      this.statement("SELECT total AS n FROM nil_totals WHERE singleton=1"),
      this.statement(
        "SELECT record FROM nil_configs ORDER BY first_seen DESC,seq DESC LIMIT 1000",
      ),
      this.statement(
        "SELECT report FROM nil_runs ORDER BY started_at DESC,id DESC LIMIT 120",
      ),
      this.statement("SELECT value FROM nil_state WHERE key='latest'"),
      this.statement("SELECT coalesce(max(seq),0) AS n FROM nil_configs"),
      this.statement("SELECT value FROM nil_state WHERE key='dataset_id'"),
    ]);
    const total = Number(results[0].results[0]?.n || 0);
    const status = (
      results[3].results[0]?.value
        ? JSON.parse(String(results[3].results[0].value))
        : emptyReport()
    ) as RunReport;
    status.totalUnique = total;
    const configs: ConfigRecord[] = [];
    let bytes = 0;
    for (const row of results[1].results) {
      const record = String(row.record);
      bytes += new TextEncoder().encode(record).length;
      if (bytes > 3 * 1024 * 1024) break;
      configs.push(JSON.parse(record) as ConfigRecord);
    }
    return {
      snapshot: {
        schemaVersion: 1,
        generatedAt: status.finishedAt || status.startedAt,
        totalUnique: total,
        configs,
      },
      status,
      history: results[2].results.map(
        (row) => JSON.parse(String(row.report)) as RunReport,
      ),
      checkpoint: Number(results[4].results[0]?.n || 0),
      datasetId: results[5].results[0]?.value
        ? JSON.parse(String(results[5].results[0].value))
        : "",
    };
  }

  async exportState() {
    const rows = await this.db.batch([
      this.statement("SELECT coalesce(max(seq),0) AS n FROM nil_configs"),
      this.statement("SELECT value FROM nil_state WHERE key='dataset_id'"),
    ]);
    return {
      checkpoint: Number(rows[0].results[0]?.n || 0),
      datasetId: rows[1].results[0]?.value
        ? (JSON.parse(String(rows[1].results[0].value)) as string)
        : "",
    };
  }

  async exportPage(cursor: number, until: number, limit = 100) {
    const rows = await this.statement(
      "SELECT seq,record FROM nil_configs WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?",
      cursor,
      until,
      limit,
    ).all<{ seq: number; record: string }>();
    const nextCursor = rows.results.at(-1)?.seq ?? cursor;
    return {
      records: rows.results.map(
        (row) => JSON.parse(row.record) as ConfigRecord,
      ),
      cursor: nextCursor,
      until,
      done: rows.results.length < limit || nextCursor >= until,
    };
  }
}
