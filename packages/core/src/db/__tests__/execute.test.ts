import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeQuery, testDbConnection } from '../execute.js';

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
