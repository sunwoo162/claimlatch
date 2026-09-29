# Changelog

## Unreleased

- Added supporting and contradicting evidence relations to verifier results.
- Added deterministic cross-source contradiction detection based on normalized source URLs.
- Added a default fail-closed policy violation for unresolved disagreement between distinct sources.

## 0.2.0 - 2026-09-28

- Added best-effort source-document hydration with quote offsets, content type, final URL, retrieval timestamp, and SHA-256 provenance.
- Added strict policy support for requiring fetched-document provenance on decisive verdicts.
- Added common literal private-network/localhost blocking, redirect revalidation, timeouts, and body-size limits for evidence fetching.
- Added DNS resolution validation and public-IP pinning for built-in provenance requests, failing closed on unsafe resolution results.
- Moved decisive evidence-binding enforcement into the ClaimLatch core so custom verifiers cannot bypass it.
- Added duplicate claim-ID rejection and selected-evidence freshness checks.
- Added a non-streaming OpenAI-compatible Chat Completions reverse proxy that returns blocked answers as HTTP 422.
- Added an independent-label benchmark runner with decision accuracy, false-pass rate, and false-block rate.
- Added a small human-authored benchmark seed with public label-source URLs.
- Expanded tests to cover provenance, SSRF guards, proxy behavior, benchmark metrics, and core plugin invariants.

## 0.1.0 - 2026-09-28

Initial V1 implementation.

- Atomic factual claim extraction through an OpenAI-compatible model adapter.
- Tavily evidence search adapter plus provider interfaces for custom sources.
- Evidence-bound `SUPPORTED`, `CONTRADICTED`, `UNSUPPORTED`, and `UNVERIFIABLE` statuses.
- Deterministic policy gate with fail-closed defaults.
- Claim/evidence ID validation and prompt-injection-resistant verifier instructions.
- TypeScript SDK, CLI, offline plumbing demo, tests, benchmark fixture format, and GitHub Actions CI.
