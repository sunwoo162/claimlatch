# Architecture

ClaimLatch is a pipeline of replaceable ports with a deterministic release boundary.

1. **ClaimExtractor** turns a draft answer into atomic factual claims.
2. **EvidenceProvider** retrieves evidence for each claim.
3. **ProvenanceEvidenceProvider** can fetch the original document and replace search snippets with an auditable quote plus content hash.
4. **ClaimVerifier** classifies the relationship between one claim and supplied evidence.
5. **Core invariant sanitizer** refuses malformed plugin output and strips invented evidence references.
6. **Policy evaluator** makes the final PASS/BLOCK decision.

The model never gets to directly decide whether the answer is released. It can propose claim/evidence relations, but the final gate result is deterministic policy code over explicit statuses and validated bindings.

## Status semantics

- `SUPPORTED`: supplied evidence directly entails the claim.
- `CONTRADICTED`: supplied evidence directly conflicts with the claim.
- `UNSUPPORTED`: relevant evidence exists but does not establish the claim.
- `UNVERIFIABLE`: no usable evidence is available or the evidence is too ambiguous to judge.

The verifier may also return `supportingEvidenceIds` and `contradictingEvidenceIds`. The core keeps only IDs that exist in the retrieved evidence. The policy evaluator treats support and contradiction from distinct normalized source URLs as a cross-source contradiction and blocks it by default.

## Coverage

Coverage is `(SUPPORTED + CONTRADICTED) / total claims`.

It is **not** an accuracy probability. A contradicted claim counts as covered because evidence was sufficient to decide it, but the default policy blocks it.

## Core invariants

The core does not assume plugins behave perfectly.

- Claim IDs must be non-empty and unique.
- Evidence with a mismatched `claimId` is discarded.
- Duplicate evidence IDs are discarded.
- Verifier evidence IDs that do not exist in retrieved evidence are discarded.
- `SUPPORTED`/`CONTRADICTED` with no valid evidence binding is downgraded to `UNVERIFIABLE`.
- Supporting and contradicting evidence relations are filtered to retrieved IDs before policy evaluation.
- The claim/evidence objects included in the final report come from the core pipeline, not arbitrary verifier replacements.

## Provenance

A `retrieved-document` evidence record contains a quote, normalized-document character offsets, final URL, retrieval time, content type, and SHA-256. PDF evidence also records the 1-based page number and page-local quote offsets. Search snippets remain explicitly labeled `search-snippet`.

PDF text is extracted page by page with PDF.js. If parsing or text extraction fails, the provider preserves the original search-snippet provenance instead of creating unverifiable document provenance.

The strict `requireRetrievedDocumentForDecisiveClaims` policy requires every selected decisive verdict to cite at least one fetched-document evidence item.

## Reverse proxy

The proxy implements `GET /v1/models`, `GET /models`, `POST /v1/chat/completions`, and `POST /chat/completions`. Model listing is a bounded metadata passthrough and never invokes the answer gate. For completions, it verifies every assistant choice in a multi-choice response; textual choices use ClaimLatch, while structured choices require an explicit application verifier. One blocked choice blocks the whole response.

```text
client
  ↓
ClaimLatch proxy
  ↓
upstream generation provider
  ↓
full draft buffered
  ↓
ClaimLatch gate
  ├─ PASS → original completion released
  └─ BLOCK → HTTP 422 + aggregate and per-choice reports
```

For `stream: true`, the proxy buffers the complete upstream SSE response privately, verifies every reconstructed choice, and replays the original frames only after PASS. Structured streaming choices remain fail-closed without an explicit verifier. The configured upstream base must be an absolute HTTP(S) URL without credentials, query, or fragment. A configured upstream API key can target a provider-specific header such as `api-key`; the completion endpoint can also use a provider-specific relative path and query; otherwise the proxy uses `Authorization` and `/chat/completions`.

## Benchmark

The benchmark runner compares end-to-end gate decisions to labels authored independently of the gate output. The default frozen dataset is verified against its SHA-256 manifest before any provider calls. False-pass rate is treated as the primary safety regression metric.

## Failure philosophy

ClaimLatch should fail closed when a verifier or evidence provider cannot produce a defensible result. Transport failures are errors; absence of evidence becomes `UNVERIFIABLE`; contradictions are explicit violations.
