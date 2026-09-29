# Changelog

## Unreleased

No unreleased changes.

## 0.3.13 - 2026-09-29

- Added explicit provider response-header name and prefix configuration for SDK and proxy CLI compatibility, while keeping response framing and hop-by-hop headers blocked.

## 0.3.12 - 2026-09-29

- Added credential-free `claimlatch-bench --help` output documenting dataset, split, manifest, and format options.

## 0.3.11 - 2026-09-29

- Added fail-closed `claimlatch-bench --split train|dev|test` selection for the frozen benchmark partitions.

## 0.3.10 - 2026-09-29

- Preserved additional provider diagnostic response headers with `X-Goog-*`, `X-Amzn-*`, and `Anthropic-*` prefixes.

## 0.3.9 - 2026-09-29

- Added a custom provider compatibility profile regression test and configuration example for provider-specific API key headers and relative completion paths.

## 0.3.8 - 2026-09-29

- Preserved provider diagnostic `X-MS-*` response headers on successful proxy responses.

## 0.3.7 - 2026-09-29

- Expanded the frozen independent benchmark to 54 balanced cases across 27 paired topics using public primary-source labels.

## 0.3.6 - 2026-09-29

- Added fail-closed benchmark manifest verification to the default benchmark CLI and SDK helpers.

## 0.3.5 - 2026-09-29

- Added a SHA-256 integrity manifest for the frozen benchmark files.
- Made benchmark manifest verification line-ending independent across Windows and Linux.

## 0.3.4 - 2026-09-29

- Added fail-closed validation for configured upstream base URLs.

## 0.3.3 - 2026-09-29

- Added configurable provider-specific upstream Chat Completions paths and query parameters.
- Added an SDK proxy example for provider-specific credential headers and deployment paths.

## 0.3.2 - 2026-09-29

- Added an explicit non-streaming structured-output verifier hook while keeping tool-call and multimodal output fail-closed by default.
- Extended the structured-output verifier hook to buffered streaming tool-call and multimodal choices without releasing SSE frames before verification.
- Added a runnable structured-output verifier example with application-owned tool allowlist policy.
- Added configurable upstream API key header compatibility for providers that do not use `Authorization`.

## 0.3.1 - 2026-09-29

- Added deterministic JSON, JUnit, and SARIF output formats to the benchmark CLI.
- Preserved the legacy `--json` benchmark flag and added `--format text|json|junit|sarif`.
- Added CI-friendly failure details for false passes and false blocks without fabricating benchmark results.
- Added optional provenance egress host and port allowlists with redirect revalidation.
- Exposed outbound allowlist configuration through `createDefaultClaimLatch`.
- Added fixed and claim-aware official-source domain policies for Tavily search with post-response filtering.
- Added a filesystem verification-receipt store and key-resolver support for rotation-aware verification.
- Expanded the frozen independent benchmark to 48 balanced cases across 24 paired topics with train/dev/test splits.
- Improved proxy compatibility by forwarding safe client metadata and preserving selected upstream request, rate-limit, and retry headers.
- Added a runnable receipt-storage integration example with ephemeral demo keys and key-resolver verification.
- Documented the fail-closed buffered and verified streaming protocol and its implementation boundaries.
- Added buffered, post-verification replay for textual Chat Completions streams with size limits and fail-closed malformed-stream handling.
- Added configurable upstream deadlines and client-disconnect cancellation for buffered proxy requests.
- Made non-streaming proxy responses fail closed for mixed multimodal content and tool-call metadata.

## 0.3.0 - 2026-09-29

- Added supporting and contradicting evidence relations to verifier results.
- Added deterministic cross-source contradiction detection based on normalized source URLs.
- Added a default fail-closed policy violation for unresolved disagreement between distinct sources.
- Added PDF.js-based page-level text extraction with page-local quote offsets and safe fallback on parse failure.
- Added deterministic Ed25519-signed verification receipts with embedded public keys and tamper detection.
- Expanded the independent benchmark seed to 32 balanced, human-authored cases across 16 paired topics.
- Updated the proxy to verify every textual choice in multi-choice completions and fail closed if any choice is blocked.
- Added a `verifyBeforeRelease` integration helper and runnable guarded-application example.

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
