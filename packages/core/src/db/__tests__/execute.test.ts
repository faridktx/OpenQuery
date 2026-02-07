import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  executeQuery,
  explainQuery,
  testDbConnection,
  introspectSchemaForConnection,
} from '../execute.js';

describe('executeQuery mysql placeholder', () => {
  it('returns a friendly planned-message for mysql connection tests', async () => {
    const result = await testDbConnection({
      dbType: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'openquery_test',
      user: 'openquery',
      password: 'openquery_dev',
      ssl: false,
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /Phase 7/i);
  });

  it('throws a friendly planned-message when executing mysql queries', async () => {
    await assert.rejects(
      executeQuery({
        dbType: 'mysql',
        host: 'localhost',
        port: 3306,
        database: 'openquery_test',
        user: 'openquery',
        password: 'openquery_dev',
        ssl: false,
        sql: 'SELECT 1',
      }),
      /MySQL support is planned for Phase 7/i,
    );
  });
});

describe('sqlite demo adapter', () => {
  const setupDb = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'openquery-sqlite-test-'));
    const dbPath = join(dir, 'demo.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        full_name TEXT NOT NULL,
        is_active INTEGER NOT NULL
      );
      INSERT INTO users (email, full_name, is_active) VALUES
        ('alice@example.com', 'Alice Nguyen', 1),
        ('bob@example.com', 'Bob Martinez', 1),
        ('carol@example.com', 'Carol Singh', 0);
    `);
    db.close();
    return dir;
  };

  it('connects, introspects, explains, and executes queries against sqlite file', async () => {
    const tempDir = setupDb();
    const dbPath = join(tempDir, 'demo.sqlite');
    const conn = {
      dbType: 'sqlite',
      host: '',
      port: 0,
      database: dbPath,
      user: '',
      password: '',
      ssl: false,
    } as const;

    try {
      const connResult = await testDbConnection(conn);
      assert.equal(connResult.ok, true);

      const snapshot = await introspectSchemaForConnection(conn);
      assert.ok(snapshot.tables.some((t: { name: string }) => t.name === 'users'));

      const explain = await explainQuery({
        ...conn,
        sql: 'SELECT id, email FROM users WHERE is_active = 1 ORDER BY id',
      });
      assert.equal(typeof explain.hasSeqScan, 'boolean');

      const query = await executeQuery({
        ...conn,
        sql: 'SELECT id, email FROM users WHERE is_active = 1 ORDER BY id',
      });
      assert.deepEqual(query.columns, ['id', 'email']);
      assert.equal(query.rowCount, 2);
      assert.equal(query.rows[0].email, 'alice@example.com');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
