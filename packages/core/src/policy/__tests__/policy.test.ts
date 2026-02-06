/**
 * Policy engine tests — Phase 2.
 * Covers parsing, rewriting, validation, and EXPLAIN evaluation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSql } from '../parse.js';
import { ensureLimit } from '../rewrite.js';
import { DefaultPolicyEngine } from '../engine.js';
import { parseExplainJson } from '../../db/adapters/postgres.js';

// ── Parsing tests ────────────────────────────────────────────────────

describe('parseSql', () => {
  it('parses a simple SELECT', () => {
    const result = parseSql('SELECT 1 as num');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, 'select');
      assert.equal(result.statementCount, 1);
    }
  });

  it('parses a CTE SELECT', () => {
    const result = parseSql('WITH cte AS (SELECT 1) SELECT * FROM cte');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, 'select');
      assert.equal(result.statementCount, 1);
    }
  });

  it('rejects multi-statement SQL', () => {
    const result = parseSql('SELECT 1; SELECT 2');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.statementCount > 1, 'Should detect multiple statements');
    }
  });

  it('classifies UPDATE as update', () => {
    const result = parseSql('UPDATE users SET name = \'x\'');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, 'update');
    }
  });

  it('classifies INSERT as insert', () => {
    const result = parseSql('INSERT INTO users (name) VALUES (\'test\')');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, 'insert');
    }
  });

  it('classifies DELETE as delete', () => {
    const result = parseSql('DELETE FROM users WHERE id = 1');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, 'delete');
    }
  });

  it('classifies DROP as drop', () => {
    const result = parseSql('DROP TABLE users');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, 'drop');
    }
  });

  it('returns error for empty SQL', () => {
    const result = parseSql('');
    assert.equal(result.ok, false);
  });
});

// ── Rewrite tests ────────────────────────────────────────────────────

describe('ensureLimit', () => {
  it('injects LIMIT when missing', () => {
    const result = ensureLimit('SELECT id FROM users', 200, 5000);
    assert.equal(result.limitApplied, true);
    assert.equal(result.clamped, false);
    assert.match(result.rewrittenSql, /LIMIT 200/i);
  });

  it('clamps LIMIT when above max', () => {
    const result = ensureLimit('SELECT id FROM users LIMIT 10000', 200, 5000);
    assert.equal(result.clamped, true);
    assert.equal(result.originalLimit, 10000);
    // The rewritten SQL should have LIMIT 5000
    assert.match(result.rewrittenSql, /5000/);
  });

  it('leaves existing LIMIT <= max intact', () => {
    const result = ensureLimit('SELECT id FROM users LIMIT 50', 200, 5000);
    assert.equal(result.limitApplied, false);
    assert.equal(result.clamped, false);
    assert.match(result.rewrittenSql, /LIMIT 50/i);
  });

  it('handles LIMIT with OFFSET', () => {
    const result = ensureLimit('SELECT id FROM users LIMIT 100 OFFSET 10', 200, 5000);
    assert.equal(result.limitApplied, false);
    assert.equal(result.clamped, false);
  });

  it('preserves query when not a SELECT', () => {
    const result = ensureLimit('INSERT INTO t VALUES (1)', 200, 5000);
    assert.equal(result.limitApplied, false);
  });
});

// ── Policy engine validation tests ───────────────────────────────────

describe('DefaultPolicyEngine.validateAndRewrite', () => {
  it('allows a simple SELECT', () => {
    const engine = new DefaultPolicyEngine({}, { disallowSelectStar: false });
    const result = engine.validateAndRewrite('SELECT 1 as num');
    assert.equal(result.allowed, true);
    assert.ok(result.rewrittenSql);
  });

  it('rejects UPDATE in safe mode', () => {
    const engine = new DefaultPolicyEngine();
    const result = engine.validateAndRewrite('UPDATE users SET name = \'x\'');
    assert.equal(result.allowed, false);
    assert.match(result.reason, /write|not allowed/i);
  });

  it('rejects DELETE in safe mode', () => {
    const engine = new DefaultPolicyEngine();
    const result = engine.validateAndRewrite('DELETE FROM users');
    assert.equal(result.allowed, false);
  });

  it('rejects DROP in safe mode', () => {
    const engine = new DefaultPolicyEngine();
    const result = engine.validateAndRewrite('DROP TABLE users');
    assert.equal(result.allowed, false);
    assert.match(result.reason, /DDL|not allowed|Dangerous|blocked/i);
  });

  it('rejects multi-statement', () => {
    const engine = new DefaultPolicyEngine({}, { disallowSelectStar: false });
    const result = engine.validateAndRewrite('SELECT 1; SELECT 2');
    assert.equal(result.allowed, false);
    assert.match(result.reason, /multiple/i);
  });

  it('disallows SELECT * when configured', () => {
    const engine = new DefaultPolicyEngine({}, { disallowSelectStar: true });
    const result = engine.validateAndRewrite('SELECT * FROM users');
    assert.equal(result.allowed, false);
    assert.match(result.reason, /SELECT \*/i);
  });

  it('allows SELECT * when not configured', () => {
    const engine = new DefaultPolicyEngine({}, { disallowSelectStar: false });
    const result = engine.validateAndRewrite('SELECT * FROM users');
    assert.equal(result.allowed, true);
  });

  it('injects LIMIT when missing', () => {
    const engine = new DefaultPolicyEngine({}, { disallowSelectStar: false, defaultLimit: 100 });
    const result = engine.validateAndRewrite('SELECT id FROM users');
    assert.equal(result.allowed, true);
    assert.ok(result.rewrittenSql?.includes('LIMIT 100') || result.rewrittenSql?.includes('limit 100'));
    assert.ok(result.warnings.some((w) => w.includes('LIMIT')));
  });

  it('provides suggestedFix for write statements', () => {
    const engine = new DefaultPolicyEngine();
    const result = engine.validateAndRewrite('INSERT INTO t VALUES (1)');
    assert.equal(result.allowed, false);
    assert.ok(result.suggestedFix);
  });
});

// ── EXPLAIN evaluation tests ─────────────────────────────────────────

describe('DefaultPolicyEngine.evaluateExplain', () => {
  it('allows when within thresholds', () => {
    const engine = new DefaultPolicyEngine();
    const result = engine.evaluateExplain({
      estimatedRows: 100,
      estimatedCost: 50,
      hasSeqScan: false,
      warnings: [],
    });
    assert.equal(result.allowed, true);
    assert.equal(result.blockers.length, 0);
  });

  it('blocks when estimated rows exceed threshold', () => {
    const engine = new DefaultPolicyEngine({}, { maxEstimatedRows: 1000 });
    const result = engine.evaluateExplain({
      estimatedRows: 5000,
      estimatedCost: 50,
      hasSeqScan: false,
      warnings: [],
    });
    assert.equal(result.allowed, false);
    assert.ok(result.blockers.length > 0);
  });

  it('blocks when estimated cost exceeds threshold', () => {
    const engine = new DefaultPolicyEngine({}, { maxEstimatedCost: 100 });
    const result = engine.evaluateExplain({
      estimatedRows: 10,
      estimatedCost: 500,
      hasSeqScan: false,
      warnings: [],
    });
    assert.equal(result.allowed, false);
  });

  it('warns on sequential scan but does not block', () => {
    const engine = new DefaultPolicyEngine();
    const result = engine.evaluateExplain({
      estimatedRows: 100,
      estimatedCost: 50,
      hasSeqScan: true,
      warnings: [],
    });
    assert.equal(result.allowed, true);
    assert.ok(result.warnings.some((w) => w.includes('sequential scan')));
  });
});

// ── EXPLAIN JSON parser tests ────────────────────────────────────────

describe('parseExplainJson', () => {
  it('extracts estimated rows and cost from fixture', () => {
    const fixture = [
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': 'users',
          'Plan Rows': 1500,
          'Total Cost': 25.5,
          'Plan Width': 100,
        },
      },
    ];

    const result = parseExplainJson(fixture);
    assert.equal(result.estimatedRows, 1500);
    assert.equal(result.estimatedCost, 25.5);
    assert.equal(result.hasSeqScan, true);
    assert.ok(result.warnings.some((w) => w.includes('users')));
  });

  it('handles nested plans', () => {
    const fixture = [
      {
        Plan: {
          'Node Type': 'Hash Join',
          'Plan Rows': 100,
          'Total Cost': 500,
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'orders',
              'Plan Rows': 10000,
              'Total Cost': 200,
            },
            {
              'Node Type': 'Index Scan',
              'Relation Name': 'users',
              'Plan Rows': 50,
              'Total Cost': 10,
            },
          ],
        },
      },
    ];

    const result = parseExplainJson(fixture);
    assert.equal(result.estimatedRows, 100);
    assert.equal(result.estimatedCost, 500);
    assert.equal(result.hasSeqScan, true);
    assert.ok(result.warnings.some((w) => w.includes('orders')));
  });

  it('handles no seq scan', () => {
    const fixture = [
      {
        Plan: {
          'Node Type': 'Index Scan',
          'Relation Name': 'users',
          'Plan Rows': 1,
          'Total Cost': 0.5,
        },
      },
    ];

    const result = parseExplainJson(fixture);
    assert.equal(result.hasSeqScan, false);
    assert.equal(result.warnings.length, 0);
  });

  it('handles malformed input gracefully', () => {
    const result = parseExplainJson(null);
    assert.equal(result.estimatedRows, 0);
    assert.equal(result.estimatedCost, 0);
    assert.ok(result.warnings.length > 0);
  });
});
