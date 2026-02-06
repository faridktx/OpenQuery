# Benchmarks

This benchmark suite measures local CPU latency for key OpenQuery guardrail paths.

Run command:

```bash
pnpm bench
```

## Latest Local Results

Date: 2026-02-06

- policy parse + validate latency: `p50=0.240ms`, `p95=0.680ms`
- explain parse latency: `p50=0.000ms`, `p95=0.001ms`
- ask dry-run latency (excluding LLM): `p50=0.352ms`, `p95=0.695ms`

Notes:

- Results are machine-dependent and should be treated as a baseline.
- Benchmarks are deterministic and do not require network calls.
