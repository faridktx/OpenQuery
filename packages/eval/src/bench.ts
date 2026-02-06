import { performance } from 'node:perf_hooks';
import {
  DefaultPolicyEngine,
  classifyStatement,
  parseExplainJson,
} from '@openquery/core';

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(name: string, samples: number[]): void {
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  console.log(`${name}: p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms n=${samples.length}`);
}

function benchPolicyValidation(): number[] {
  const engine = new DefaultPolicyEngine(
    { mode: 'safe' },
    { disallowSelectStar: true, enforceLimit: true, requireExplain: true },
  );

  const queries = [
    'SELECT id, email FROM users WHERE is_active = true ORDER BY id',
    "SELECT u.email, SUM(o.total_cents) AS total_spent FROM users u JOIN orders o ON o.user_id = u.id WHERE o.status = 'paid' GROUP BY u.email ORDER BY total_spent DESC LIMIT 10",
    'SELECT id, created_at FROM orders ORDER BY created_at DESC LIMIT 25',
  ];

  const samples: number[] = [];
  for (let i = 0; i < 400; i++) {
    const sql = queries[i % queries.length];
    const start = performance.now();
    engine.validateAndRewrite(sql);
    samples.push(performance.now() - start);
  }
  return samples;
}

function benchExplainParse(): number[] {
  const fixture = [
    {
      Plan: {
        'Node Type': 'Hash Join',
        'Plan Rows': 125,
        'Total Cost': 875,
        Plans: [
          {
            'Node Type': 'Seq Scan',
            'Relation Name': 'orders',
            'Plan Rows': 1000,
            'Total Cost': 500,
          },
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'users',
            'Plan Rows': 100,
            'Total Cost': 25,
          },
        ],
      },
    },
  ];

  const samples: number[] = [];
  for (let i = 0; i < 1200; i++) {
    const start = performance.now();
    parseExplainJson(fixture);
    samples.push(performance.now() - start);
  }
  return samples;
}

function benchDryRunNoLlm(): number[] {
  const engine = new DefaultPolicyEngine(
    { mode: 'safe' },
    { blockedTables: ['internal_audit_log'], disallowSelectStar: true, enforceLimit: true },
  );

  const fixtureSql =
    "SELECT u.email, SUM(o.total_cents) AS total_spent FROM users u JOIN orders o ON o.user_id = u.id WHERE o.status = 'paid' GROUP BY u.email ORDER BY total_spent DESC LIMIT 10";

  const explain = {
    estimatedRows: 10,
    estimatedCost: 180,
    hasSeqScan: false,
    warnings: [],
  };

  const samples: number[] = [];
  for (let i = 0; i < 500; i++) {
    const start = performance.now();
    const classification = classifyStatement(fixtureSql);
    const validation = engine.validateAndRewrite(fixtureSql);
    if (validation.allowed && classification.classification === 'read') {
      engine.evaluateExplain(explain);
    }
    samples.push(performance.now() - start);
  }

  return samples;
}

function main(): void {
  console.log('OpenQuery Benchmark Suite');
  console.log('All timings are local-process latency.');

  summarize('policy parse+validate', benchPolicyValidation());
  summarize('explain parse', benchExplainParse());
  summarize('ask dry-run (no LLM)', benchDryRunNoLlm());
}

main();
