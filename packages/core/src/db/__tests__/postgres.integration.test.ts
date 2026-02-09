import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadFixtureEnvIfNeeded } from './fixture-env.js';
import {
  executeQuery,
  explainQuery,
  introspectSchema,
  testDbConnection,
} from '../../index.js';

const RUN = process.env.OPENQUERY_PG_INTEGRATION === '1';
const runDescribe = RUN ? describe : describe.skip;
loadFixtureEnvIfNeeded();

const cfg = {
  dbType: 'postgres',
  host: process.env.OPENQUERY_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.OPENQUERY_PG_PORT ?? '5432'),
  database: process.env.OPENQUERY_PG_DATABASE ?? 'openquery_test',
  user: process.env.OPENQUERY_PG_USER ?? 'openquery',
  password: process.env.OPENQUERY_PG_PASSWORD ?? 'openquery_dev',
  ssl: false,
} as const;

async function applySeed(): Promise<void> {
  const seedPath = resolve(process.cwd(), '../../infra/docker/seed.sql');
  const sql = readFileSync(seedPath, 'utf-8');
  const statements = sql
    .split(/;\s*\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: false,
  });

  await client.connect();
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    await client.end();
  }
}

runDescribe('postgres integration', () => {
  before(async () => {
    await applySeed();
  });

  it('connects to fixture postgres database', async () => {
    const result = await testDbConnection(cfg);
    assert.equal(result.ok, true);
  });

  it('introspects seeded tables', async () => {
    const snapshot = await introspectSchema(
      {
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.user,
        ssl: false,
      },
      cfg.password,
    );

    const tableNames = snapshot.tables.map((t) => `${t.schema}.${t.name}`);
    assert.ok(tableNames.includes('public.users'));
    assert.ok(tableNames.includes('public.orders'));
  });

  it('executes read queries with row results', async () => {
    const result = await executeQuery({
      ...cfg,
      sql: 'SELECT id, email FROM users ORDER BY id LIMIT 5',
    });

    assert.equal(result.columns.includes('id'), true);
    assert.equal(result.columns.includes('email'), true);
    assert.ok(result.rows.length >= 1);
  });

  it('generates explain summary for seeded query', async () => {
    const explain = await explainQuery({
      ...cfg,
      sql: 'SELECT id, total_cents FROM orders WHERE total_cents > 1000 LIMIT 20',
    });

    assert.ok(explain.estimatedRows >= 0);
    assert.ok(explain.estimatedCost >= 0);
  });
});
