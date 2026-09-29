# ClaimLatch

**Evidence-backed release gates for LLM answers.**

LLMs can produce fluent answers before they have earned the level of certainty a user assumes. ClaimLatch sits between generation and delivery: it extracts factual claims, gathers evidence, binds verifier decisions to concrete evidence, and deterministically **PASSes or BLOCKs** the draft according to policy.

> ClaimLatch does not ask a model "how confident are you?" and turn that self-report into a trust score.

## Pipeline

```text
User question
    ↓
LLM draft answer
    ↓
ClaimExtractor
    ↓
EvidenceProvider
    ↓
optional document provenance hydration
    ↓
ClaimVerifier
    ↓
core invariant sanitizer
    ↓
Deterministic policy gate
    ↓
PASS / BLOCK
```

Each factual claim ends in exactly one state:

- `SUPPORTED`
- `CONTRADICTED`
- `UNSUPPORTED`
- `UNVERIFIABLE`

`coverage` is the fraction of claims for which evidence was sufficient to make a supported/contradicted decision. It is **not an accuracy percentage**.

## Install / build

```bash
npm install
npm run build
npm test
```

Node.js 20+ is supported. The runtime has no npm dependencies; TypeScript is a development dependency.

## CLI

Configure an OpenAI-compatible verifier model plus Tavily search:

```bash
export CLAIMLATCH_LLM_API_KEY="..."
export CLAIMLATCH_LLM_MODEL="your-model"
# optional: export CLAIMLATCH_LLM_BASE_URL="https://your-endpoint/v1"
export TAVILY_API_KEY="..."
```

Verify a draft before returning it to a user:

```bash
claimlatch \
  --question "What version is currently supported?" \
  --answer "Version 4 is the current LTS release."
```

By default, search results are best-effort hydrated from the original web page. The report records whether selected evidence came from a `search-snippet` or a `retrieved-document` quote.

Strict provenance mode refuses decisive verdicts that are backed only by search snippets:

```bash
claimlatch \
  -q "..." \
  -a "..." \
  --require-document-provenance
```

A blocked report exits with code `1`; usage/provider failures exit with code `2`.

Machine-readable output:

```bash
claimlatch -q "..." -a "..." --json
```

## OpenAI-compatible reverse proxy

`claimlatch-proxy` can sit in front of a Chat Completions-compatible provider. It buffers the generated answer, verifies it, and only releases the upstream completion after PASS.

```bash
export CLAIMLATCH_PROXY_UPSTREAM_BASE_URL="https://api.openai.com/v1"
export CLAIMLATCH_PROXY_UPSTREAM_API_KEY="..."

export CLAIMLATCH_LLM_API_KEY="..."
export CLAIMLATCH_LLM_MODEL="your-verifier-model"
export TAVILY_API_KEY="..."

claimlatch-proxy
```

Point an existing client at:

```text
http://127.0.0.1:4317/v1
```

Behavior:

- PASS: returns the original upstream Chat Completions JSON with `x-claimlatch-result: pass`.
- BLOCK: returns HTTP `422` with `error.code = "claimlatch_blocked"` plus the verification report.
- `stream: true`: rejected for now. Releasing tokens before verification would bypass the gate.
- `/health`: lightweight local health endpoint.

If `CLAIMLATCH_PROXY_UPSTREAM_API_KEY` is omitted, the proxy forwards the incoming `Authorization` header to the upstream provider. The proxy binds to `127.0.0.1` by default.

Do **not** point `CLAIMLATCH_LLM_BASE_URL` back at the ClaimLatch proxy itself; use a verifier endpoint that does not recursively traverse the gate.

Optional proxy settings:

```bash
export CLAIMLATCH_PROXY_HOST="127.0.0.1"
export CLAIMLATCH_PROXY_PORT="4317"
export CLAIMLATCH_REQUIRE_DOCUMENT_PROVENANCE="1"
```

V0.2 proxy scope is deliberately small: Chat Completions only, textual user/assistant content, non-streaming.

## SDK

```ts
import {
  ClaimLatch,
  LlmClaimExtractor,
  LlmClaimVerifier,
  OpenAICompatibleClient,
  ProvenanceEvidenceProvider,
  TavilyEvidenceProvider,
} from "claimlatch";

const llm = new OpenAICompatibleClient({
  apiKey: process.env.CLAIMLATCH_LLM_API_KEY,
  model: process.env.CLAIMLATCH_LLM_MODEL!,
});

const search = new TavilyEvidenceProvider({
  apiKey: process.env.TAVILY_API_KEY!,
  primaryDomains: ["docs.example.com"],
});

const gate = new ClaimLatch({
  extractor: new LlmClaimExtractor(llm),
  evidenceProvider: new ProvenanceEvidenceProvider({ provider: search }),
  verifier: new LlmClaimVerifier(llm),
});

const report = await gate.verify({
  question,
  answer: draft,
  policy: {
    minimumCoverage: 1,
    maxUnsupportedClaims: 0,
    maxUnverifiableClaims: 0,
    blockOnContradiction: true,
    requireRetrievedDocumentForDecisiveClaims: true,
  },
});

if (!report.passed) {
  // Do not deliver the draft as a verified answer.
}
```

All extraction/search/verification components are interfaces, so local models, private corpora, official APIs, or custom RAG systems can replace the bundled adapters.

## Evidence provenance

When document hydration succeeds, ClaimLatch stores:

- the final source URL after validated redirects;
- the exact quote supplied to the verifier;
- quote character offsets in normalized source text;
- retrieval timestamp and content type;
- SHA-256 of the normalized retrieved document.

This makes a verdict auditable. It does **not** prove the publisher is correct or that HTML extraction preserved every nuance.

The built-in fetcher blocks common literal localhost/private-network targets, resolves and validates DNS addresses before every request, pins the selected public IP for the connection, validates redirects, caps body size, and times out fetches. Custom fetch/request transports must preserve equivalent protections. Read `docs/TRUST_MODEL.md` and `SECURITY.md` for remaining network risks.

## Default gate policy

The default policy is deliberately strict:

- block every contradiction;
- allow zero unsupported claims;
- allow zero unverifiable claims;
- require 100% evidence coverage;
- require every critical claim to be `SUPPORTED`;
- fail closed when the extractor returns zero verifiable claims.

Document-level provenance is available as an additional strict policy, but is not enabled by default because some legitimate sources cannot be fetched reliably.

Core invariants are enforced again after custom providers return: duplicate claim IDs are rejected, invented evidence bindings are removed, and decisive verdicts with no valid evidence binding are downgraded to `UNVERIFIABLE`.

## Independent-label benchmark seed

`benchmarks/independent.jsonl` contains human-authored positive/negative answer pairs with public label-source URLs. Labels are not generated from ClaimLatch output.

Run against configured live providers:

```bash
claimlatch-bench --dataset benchmarks/independent.jsonl
# or
npm run bench
```

Reported metrics include:

- decision accuracy against dataset labels;
- **false-pass rate**: false answers that escaped the gate;
- false-block rate: labeled-correct answers that the gate rejected.

The bundled seed is intentionally small and is not publication-quality evaluation. Its purpose is to make regressions measurable without pretending that a hand-sized fixture is a universal benchmark.

## Why no confidence score?

A fabricated `87% trustworthy` badge would recreate the problem ClaimLatch is meant to solve. ClaimLatch reports observable states: what claims were found, what evidence was retrieved, what relationship was judged, and which deterministic rule blocked the answer.

Any future probabilistic score should be calibrated against independently labeled data and should describe measured behavior, not model self-confidence.

## Offline demo

The offline demo uses deterministic fake providers to demonstrate gate behavior without making model/network calls:

```bash
npm run demo
```

It is a plumbing demo, not a factuality benchmark.

## Trust boundary

A PASS is not a proof of universal truth. Extraction, search, source selection, document parsing, and entailment can all fail. Read [docs/TRUST_MODEL.md](docs/TRUST_MODEL.md) before using ClaimLatch for high-stakes decisions.

## Project status

`0.2.0` adds quote-level web provenance, core provider invariant enforcement, an OpenAI-compatible buffering proxy, and an independent-label benchmark runner. Public API and provider behavior may change before `1.0`.

## License

Apache-2.0.
