import type { PGlite, Transaction } from '@electric-sql/pglite';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type DbHandle = Pick<PGlite, 'query' | 'exec' | 'transaction'>;

function wrapClient(client: PoolClient): Transaction {
  return {
    query: async <T = QueryResultRow>(sql: string, params?: unknown[]) => {
      const res = await client.query(sql, params);
      return { rows: res.rows as T[], affectedRows: res.rowCount ?? 0, fields: [] };
    },
    exec: async (sql: string) => {
      await client.query(sql);
      return [];
    },
    rollback: async () => {
      await client.query('ROLLBACK');
    },
    get closed() {
      return false;
    },
  } as unknown as Transaction;
}

export class PgAdapter {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 16,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async exec(sql: string) {
    const client = await this.pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  /**
   * Изолированный контекст конкретного клуба:
   * в каждой транзакции выставляется SET LOCAL app.club_id = $1,
   * поэтому PostgreSQL RLS физически не отдаст и не изменит строки чужого клуба.
   */
  forClub(clubId: string): PGlite {
    const pool = this.pool;
    return {
      query: async <T = QueryResultRow>(sql: string, params?: unknown[]) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.club_id', $1, true)", [clubId]);
          const res = await client.query(sql, params);
          await client.query('COMMIT');
          return { rows: res.rows as T[], affectedRows: res.rowCount ?? 0, fields: [] };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      exec: async (sql: string) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.club_id', $1, true)", [clubId]);
          await client.query(sql);
          await client.query('COMMIT');
          return [];
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      transaction: async <T>(callback: (tx: Transaction) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.club_id', $1, true)", [clubId]);
          const result = await callback(wrapClient(client));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
    } as unknown as PGlite;
  }

  /**
   * Системный контекст — используется ТОЛЬКО в auth.ts (логин, проверка сессии, инвайты, ТВ-токены).
   */
  async systemTransaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.system', '1', true)");
      const result = await callback(wrapClient(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
