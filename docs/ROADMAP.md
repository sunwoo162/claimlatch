# Roadmap

## V0.1 — initial gate

- Atomic claim extraction
- Evidence-provider interface
- Tavily search adapter
- Evidence-bound verification
- Deterministic policy gate
- CLI and TypeScript SDK
- Unit/contract tests

## V0.2 — provenance and integration

- Best-effort HTML/text source retrieval
- Quote-level provenance with normalized-content SHA-256
- Literal private-target and redirect SSRF guards
- Core invariant enforcement for custom extractors/verifiers
- OpenAI-compatible non-streaming Chat Completions reverse proxy
- Human-authored independent-label benchmark seed
- False-pass / false-block metrics

## Next

- Hardened egress fetcher and outbound allowlist options
- PDF evidence extraction with page/quote provenance
- Official-source resolvers and domain policies
- Persistent signed verification receipts
- SARIF/JUnit outputs for CI
- Larger frozen benchmark with train/dev/test separation
- Calibration experiments only after enough independent labels exist
- Safe buffered/verified streaming protocol design

## Explicitly not promised

- A universal "87% trustworthy" score
- A claim that one LLM judge solves hallucination
- Hidden chain-of-thought based judgments
- Universal OpenAI API compatibility in V0.2
