# Benchmarks

`independent.jsonl` is a 48-case, human-authored end-to-end benchmark dataset with 24 positive and 24 negative cases across 24 paired topics. Labels are written independently of ClaimLatch output and each case records one or more public label-source URLs.

The aggregate is partitioned into frozen, balanced splits:

- `train.jsonl`: 32 cases across the original 16 paired topics
- `dev.jsonl`: 8 cases across four additional paired topics
- `test.jsonl`: 8 cases across four additional paired topics

Every case appears exactly once across the three splits. Keep the test split untouched while tuning prompts, provider settings, or policies.

The important metric is **false-pass rate**: among deliberately false answers, how often did the configured gate return PASS?

Run with real providers:

```bash
npm run bench
```

or:

```bash
claimlatch-bench --dataset benchmarks/independent.jsonl
```

Run a split directly:

```bash
claimlatch-bench --dataset benchmarks/train.jsonl
claimlatch-bench --dataset benchmarks/dev.jsonl
claimlatch-bench --dataset benchmarks/test.jsonl
```

For CI integrations, select a machine-readable report format:

```bash
claimlatch-bench --dataset benchmarks/independent.jsonl --format junit > claimlatch-benchmark.xml
claimlatch-bench --dataset benchmarks/independent.jsonl --format sarif > claimlatch-benchmark.sarif
```

`--format json` and the legacy `--json` flag emit the complete benchmark report. JUnit marks incorrect decisions as failures; SARIF reports incorrect decisions with `FALSE_PASS` or `FALSE_BLOCK` rules. No format changes the benchmark labels or invents results.

This set is still not a publication-quality factuality benchmark. It exists to make regressions measurable with a frozen train/dev/test layout. This change does not claim any benchmark result; run the benchmark with configured live providers and report the resulting metrics separately.
