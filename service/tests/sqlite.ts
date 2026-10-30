// Real SQLite executes the same parameterized SQL as production D1.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { SqlDatabase, SqlStatement, SqlResult } from "../database.ts";

export class TestDatabase implements SqlDatabase {
  readonly connection = new DatabaseSync(":memory:");
  constructor() {
    this.connection.exec(
      readFileSync(
        new URL("../migrations/0001_collector.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  prepare(query: string): SqlStatement {
    const db = this.connection;
    let values: unknown[] = [];
    const statement: SqlStatement = {
      bind(...params: unknown[]) {
        values = params;
        return statement;
      },
      async first<T>() {
        return (db.prepare(query).get(...(values as never[])) ||
          null) as T | null;
      },
      async all<T>() {
        return {
          results: db.prepare(query).all(...(values as never[])) as T[],
        };
      },
      async run() {
        const result = db.prepare(query).run(...(values as never[]));
        return { results: [], meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  }
  async batch<T>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const results: SqlResult<T>[] = [];
      for (const statement of statements)
        results.push(await statement.all<T>());
      this.connection.exec("COMMIT");
      return results;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.connection.close();
  }
}
