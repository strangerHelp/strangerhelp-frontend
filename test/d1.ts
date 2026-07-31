import { DatabaseSync } from 'node:sqlite';

/**
 * Minimal D1Database implementation backed by node:sqlite.
 *
 * The Workers runtime (workerd) requires macOS 13.5+, which this machine does
 * not meet, so @cloudflare/vitest-pool-workers cannot start. This adapter runs
 * the same SQL against real SQLite so schema and query behaviour are still
 * exercised; only the JS host differs, which does not affect the
 * authentication, authorization and validation logic under test.
 *
 * Implements the subset of the D1 API the app actually uses:
 *   prepare().bind().first() / .all() / .run()
 */
export function createTestD1(): any {
  const db = new DatabaseSync(':memory:');

  function statement(sql: string, bound: unknown[] = []): any {
    return {
      bind: (...args: unknown[]) => statement(sql, args),

      first: async () => {
        const row = db.prepare(sql).get(...(bound as any[]));
        return row === undefined ? null : row; // D1 returns null, node:sqlite undefined
      },

      all: async () => {
        const results = db.prepare(sql).all(...(bound as any[]));
        return { results, success: true, meta: {} };
      },

      run: async () => {
        const info = db.prepare(sql).run(...(bound as any[]));
        return {
          success: true,
          meta: {
            changes: Number(info.changes ?? 0),
            last_row_id: Number(info.lastInsertRowid ?? 0),
          },
        };
      },
    };
  }

  return {
    prepare: (sql: string) => statement(sql),
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    batch: async (stmts: any[]) => Promise.all(stmts.map((s) => s.run())),
    _raw: db,
  };
}
