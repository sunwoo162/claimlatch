# Benchmarks

`independent.jsonl` is a 32-case, human-authored end-to-end benchmark seed with 16 positive and 16 negative cases across 16 paired topics. Labels are written independently of ClaimLatch output and each case records one or more public label-source URLs.

The important metric is **false-pass rate**: among deliberately false answers, how often did the configured gate return PASS?

Run with real providers:

```bash
npm run bench
```

or:

```bash
claimlatch-bench --dataset benchmarks/independent.jsonl
```

This set is still not a publication-quality factuality benchmark. It exists to make regressions measurable while a larger frozen dataset with train/dev/test separation is built. Do not tune prompts against the test cases and then describe the result as independent evaluation.
