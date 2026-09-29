# ClaimLatch

**An evidence-backed release gate for LLM answers.**

LLMs can produce fluent answers before they have earned the level of confidence a user expects. ClaimLatch sits between generation and delivery: it extracts factual claims, gathers evidence, binds each claim to concrete evidence, verifies the result, and deterministically **PASS**es or **BLOCK**s the draft according to policy.

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
Optional document provenance hydration
    ↓
ClaimVerifier
    ↓
Core invariant enforcement
    ↓
Deterministic policy gate
    ↓
PASS / BLOCK
```

Every factual claim ends in exactly one of these states:

- `SUPPORTED`
- `CONTRADICTED`
- `UNSUPPORTED`
- `UNVERIFIABLE`

`coverage` is the fraction of claims that could receive a supported or contradicted verdict based on sufficient evidence. It is not an accuracy percentage.

## Install and build

```bash
npm install
npm run build
npm test
```

Node.js 20 or later is supported. PDF extraction uses the PDF.js runtime dependency; TypeScript is a development-only dependency.

## CLI

Configure an OpenAI-compatible verification model and Tavily search.

```bash
export CLAIMLATCH_LLM_API_KEY="..."
export CLAIMLATCH_LLM_MODEL="your-model"
# Optional: export CLAIMLATCH_LLM_BASE_URL="https://your-endpoint/v1"
export TAVILY_API_KEY="..."
```

Verify a draft answer before delivering it to a user.

```bash
claimlatch \
  --question "What is the currently supported version?" \
  --answer "Version 4 is the current LTS release."
```

By default, search results are hydrated from the original web page when possible. The report records whether selected evidence is a `search-snippet` or a `retrieved-document` quote.

Strict provenance mode rejects decisive verdicts backed only by search snippets.

```bash
claimlatch \
  -q "..." \
  -a "..." \
  --require-document-provenance
```

Blocked reports return exit code `1`; usage or provider errors return exit code `2`.

Use `--json` for machine-readable output.

```bash
claimlatch -q "..." -a "..." --json
```

## OpenAI-compatible reverse proxy

`claimlatch-proxy` can sit in front of an OpenAI Chat Completions-compatible provider. It buffers the generated answer, verifies it, and releases the upstream completion only when it passes.

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
- When upstream returns multiple textual choices, such as with `n > 1`, every choice is verified and the response headers report aggregate coverage and claim counts.
- Compatible end-to-end request headers such as `Accept`, `OpenAI-Organization`, `OpenAI-Project`, and client request IDs are forwarded. A configured `CLAIMLATCH_PROXY_UPSTREAM_API_KEY` overrides the incoming `Authorization` header.
- Upstream `OpenAI-*`, `X-RateLimit-*`, `RateLimit-*`, `Retry-After`, `X-Request-Id`, and `Content-Type` response headers are preserved on released responses.
- BLOCK: returns HTTP `422` with `error.code = "claimlatch_blocked"` and verification reports.
- If any choice is blocked, the entire response is blocked and per-choice reports are returned as `claimlatchReports`.
- `stream: true`: the upstream SSE stream is buffered privately, every textual choice is verified, and the stream is replayed only after PASS. Structured choices can be released only through an explicit `structuredOutputVerifier`; otherwise blocked, malformed, truncated, or over-limit streams fail closed.
- `/health`: a lightweight local health endpoint.

If no upstream API key is configured, the incoming `Authorization` header is forwarded to the upstream provider. The proxy binds to `127.0.0.1` by default.

Do not set the ClaimLatch proxy itself as `CLAIMLATCH_LLM_BASE_URL`. The verifier must use an endpoint that does not recursively pass through the gate.

Optional proxy settings:

```bash
export CLAIMLATCH_PROXY_HOST="127.0.0.1"
export CLAIMLATCH_PROXY_PORT="4317"
export CLAIMLATCH_REQUIRE_DOCUMENT_PROVENANCE="1"
export CLAIMLATCH_PROXY_UPSTREAM_TIMEOUT_MS="120000"
export CLAIMLATCH_PROXY_UPSTREAM_API_KEY_HEADER="api-key"
```

SDK callers can set `upstreamApiKeyHeader` when the generation provider expects a credential header other than `Authorization` (for example, Azure-style `api-key`). The default remains `authorization`, which formats a configured key as `Bearer <key>`. `maxBufferedResponseBytes`, `maxBufferedChoices`, `maxBufferedChoiceBytes`, and `upstreamTimeoutMs` bound the private stream buffer, number of choices, reconstructed choice payload per choice, and upstream request duration before verification. The upstream timeout defaults to 120 seconds; set it to `0` only when the deployment intentionally manages the deadline elsewhere. A client disconnect aborts the in-flight upstream request.

By default, non-streaming and buffered streaming tool-call or multimodal choices fail closed because ClaimLatch cannot infer safe semantics for an action or non-text output. An application may explicitly provide `structuredOutputVerifier` to `createOpenAIProxy`; the hook receives the reconstructed raw choice and a `stream` boolean, and must return a `VerificationReport` after applying the application's tool or multimodal safety policy. Hook failures return `502`, and no SSE frame is released before every choice passes.

The proxy intentionally has a small scope: Chat Completions, text-form user/assistant content, multiple choices, and buffered verified streaming. Structured output requires an application-provided verifier; mixed or unsupported output shapes fail closed instead of dropping unknown parts. Hop-by-hop headers, cookies, host metadata, and request body framing headers are not forwarded to the upstream. See [the streaming protocol](docs/STREAMING.md) for the limits and fail-closed behavior.

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
  // Do not release the draft as a verified answer.
}
```

All extraction, search, and verification components are defined as interfaces. You can replace the default adapters with a local model, private corpus, official API, or custom RAG system.

Tavily search can apply an official-source domain policy. `officialDomains` scopes every search to fixed domains; `resolveOfficialDomains` can return domains from the claim (for example, government, standards, or vendor documentation domains). Configured policy results are filtered again after the API response, and an empty or failing resolver returns no evidence instead of falling back to unrestricted search.

When using `createDefaultClaimLatch`, document hydration can be restricted with an outbound allowlist. Host entries match the exact host and its subdomains; configured ports are checked against explicit URL ports or the scheme defaults (`80` for HTTP and `443` for HTTPS). The allowlist is checked again for every redirect.

```ts
import { createDefaultClaimLatch } from "claimlatch";

const gate = createDefaultClaimLatch({
  llmModel: "your-verifier-model",
  tavilyApiKey: process.env.TAVILY_API_KEY!,
  outboundAllowlist: {
    hosts: ["docs.example.com", "www.example.org"],
    ports: [443],
  },
});
```

## Application integration example

`verifyBeforeRelease` returns a draft only when it passes at the application's final delivery boundary. On BLOCK it throws `ClaimLatchBlockedError` with the verification report, so the error path can keep the draft away from the user.

```bash
export CLAIMLATCH_EXAMPLE_QUESTION="What is the current release status?"
export CLAIMLATCH_EXAMPLE_DRAFT="The current release is stable."
export CLAIMLATCH_LLM_MODEL="your-verifier-model"
export CLAIMLATCH_LLM_API_KEY="..."
export TAVILY_API_KEY="..."

npm run example:guarded
```

The complete example is in [`examples/guarded-answer.ts`](examples/guarded-answer.ts). In a real application, replace `CLAIMLATCH_EXAMPLE_DRAFT` with the result of the generation call and deliver only the `answer` returned by `verifyBeforeRelease`.

### Structured-output proxy policy example

`structuredOutputVerifier` is the application-owned safety boundary for tool calls and multimodal output. The runnable example below allows only the comma-separated tool names in `CLAIMLATCH_ALLOWED_TOOLS`; any other tool call is returned as a deterministic BLOCK report. The example uses a local policy report for structured output and the configured ClaimLatch gate for ordinary textual responses.

```bash
export CLAIMLATCH_LLM_MODEL="your-verifier-model"
export CLAIMLATCH_LLM_API_KEY="..."
export TAVILY_API_KEY="..."
export CLAIMLATCH_PROXY_UPSTREAM_API_KEY="..."
export CLAIMLATCH_ALLOWED_TOOLS="lookup,search"

npm run example:structured
```

The complete example is in [`examples/structured-output-verifier.ts`](examples/structured-output-verifier.ts). It demonstrates the important boundary: ClaimLatch does not infer whether an action is safe; the application must define and verify its own allowlist before any buffered stream is released.

## Signed verification receipts

A verification report can be wrapped in an Ed25519-signed receipt. The receipt includes the report and public key in its payload, then signs the complete payload using canonical JSON serialization.

```ts
import {
  createSignedVerificationReceipt,
  verifySignedVerificationReceipt,
} from "claimlatch";

const receipt = createSignedVerificationReceipt(report, {
  privateKeyPem: process.env.CLAIMLATCH_RECEIPT_PRIVATE_KEY!,
  publicKeyPem: process.env.CLAIMLATCH_RECEIPT_PUBLIC_KEY!,
  keyId: "production-verifier-2026",
});

const isAuthentic = verifySignedVerificationReceipt(receipt);
```

The signature does not establish that the report is factually correct. It only authenticates that the signed report payload has not changed and was verified against a particular public key. Manage the private key using an environment-appropriate secure mechanism such as a secret manager.

For a simple persistent backend, ClaimLatch includes a filesystem store. Receipt IDs are validated as safe filenames, writes use a temporary file followed by rename, and missing receipts return `undefined`; the store does not replace signature verification.

```ts
import {
  FileVerificationReceiptStore,
  verifySignedVerificationReceipt,
} from "claimlatch";

const store = new FileVerificationReceiptStore({ directory: "./var/claimlatch-receipts" });
await store.save("answer-2026-09-29-001", receipt);

const stored = await store.load("answer-2026-09-29-001");
const authentic = stored !== undefined && verifySignedVerificationReceipt(stored);
```

For key rotation, issue a unique `keyId` for each signing key and keep old public keys available for the receipt retention period. Resolve the key by `keyId` when verifying; removing a retired key intentionally makes receipts signed by it fail closed.

```ts
const publicKeys: Record<string, string> = {
  "production-verifier-2026": process.env.CLAIMLATCH_RECEIPT_PUBLIC_KEY_2026!,
  "production-verifier-2027": process.env.CLAIMLATCH_RECEIPT_PUBLIC_KEY_2027!,
};

const authenticAfterRotation = verifySignedVerificationReceipt(stored!, {
  keyResolver: (keyId) => (keyId ? publicKeys[keyId] : undefined),
});
```

Do not put private keys in the receipt directory or source control. Use a secret manager/HSM, restrict receipt directory permissions, define a retention policy, and back up receipts with their public-key registry if historical verification is required.

The runnable [`examples/receipt-storage.ts`](examples/receipt-storage.ts) example generates an ephemeral Ed25519 key, saves a receipt, loads it from the filesystem store, and verifies it through a key resolver:

```bash
npm run example:receipts
```

The generated key is for demonstration only. Production applications should load signing keys from a secret manager or HSM and use a durable, access-controlled receipt directory.

## Evidence provenance

When document hydration succeeds, ClaimLatch stores:

- the final source URL after validated redirects
- the exact quote passed to the verifier
- character offsets for the quote in normalized source text
- for PDFs, the page number and page-local quote offsets
- retrieval time and content type
- SHA-256 of the normalized retrieved document

This makes a verdict auditable. It does not prove that the publisher is correct or that HTML extraction preserved every piece of context.

The built-in fetcher blocks common localhost/private-network targets and resolves DNS addresses before making a request. If any resolved address is not public, it fails closed and pins the connection to a selected public IP. Redirects are validated again, and response size and timeout are limited. If you provide a custom fetch/request transport, you must preserve the same protections yourself. See `docs/TRUST_MODEL.md` and `SECURITY.md` for remaining network risks.

For deployments with a restricted egress policy, configure `outboundAllowlist` on `ProvenanceEvidenceProvider` or `createDefaultClaimLatch`. A blocked host or port never reaches the configured fetch transport and falls back to search-snippet provenance.

`application/pdf` documents are extracted page by page with PDF.js. Quotes are linked to the most relevant page, and the page number plus page-local offsets are recorded in provenance. If PDF parsing or text extraction fails, the document is not used as decisive document evidence and the provider falls back to search-snippet provenance.

## Default gate policy

The default policy is intentionally strict:

- blocks every contradiction
- blocks a cross-source contradiction when distinct sources support and contradict the same claim
- allows no unsupported claims
- allows no unverifiable claims
- requires 100% evidence coverage
- requires every critical claim to be `SUPPORTED`
- fails closed when no verifiable claims are extracted

Document-level provenance can be enabled as an additional strict policy. It is not enabled by default because some otherwise valid sources cannot be fetched reliably.

Core invariants are checked again after custom providers return. Duplicate claim IDs are rejected, nonexistent evidence bindings are removed, and decisive verdicts without valid evidence bindings are downgraded to `UNVERIFIABLE`.

## Independent-label benchmark

`benchmarks/independent.jsonl` contains 48 cases across 24 paired topics, with one positive and one negative answer per topic. Each case records a public label-source URL, and labels were not generated from ClaimLatch output. The same frozen aggregate is partitioned into `benchmarks/train.jsonl` (32 cases), `benchmarks/dev.jsonl` (8 cases), and `benchmarks/test.jsonl` (8 cases), with balanced positive and negative labels in every split.

Run it with configured live providers:

```bash
claimlatch-bench --dataset benchmarks/independent.jsonl
# or
npm run bench
```

Run an individual frozen split when tuning or validating a configuration:

```bash
claimlatch-bench --dataset benchmarks/train.jsonl
claimlatch-bench --dataset benchmarks/dev.jsonl
claimlatch-bench --dataset benchmarks/test.jsonl
```

The benchmark CLI defaults to human-readable text. Use `--format json`, `--format junit`, or `--format sarif` for CI and automation. The legacy `--json` flag remains supported.

```bash
claimlatch-bench --dataset benchmarks/independent.jsonl --format junit > claimlatch-benchmark.xml
claimlatch-bench --dataset benchmarks/independent.jsonl --format sarif > claimlatch-benchmark.sarif
```

JUnit includes every benchmark case and marks incorrect decisions as failures. SARIF emits incorrect decisions as `FALSE_PASS` or `FALSE_BLOCK` results with deterministic benchmark-line locations. These formats serialize the observed run; they do not create or infer benchmark results.

Reported metrics:

- decision accuracy against the dataset labels
- **false-pass rate**: the fraction of deliberately incorrect answers that pass the gate
- false-block rate: the fraction of correctly labeled answers that the gate rejects

This is a frozen regression dataset, not a publication-quality benchmark. Do not tune prompts against the test split and then describe the result as an independent evaluation.

## Why there is no confidence score

A badge such as `87% trustworthy` would reproduce the problem ClaimLatch is meant to address. ClaimLatch reports observable states: which claims were found, which evidence was collected, how evidence relates to each claim, and which deterministic rule blocked the answer.

If probability scores are added later, they should be calibrated with independent labels and describe measured behavior rather than model self-confidence.

## Offline demo

The offline demo shows the gate with deterministic fake providers and makes no network or model calls.

```bash
npm run demo
```

It demonstrates plumbing, not factuality benchmark performance.

## Trust boundary

PASS is not proof of universal truth. Claim extraction, search, source selection, document parsing, and entailment can all fail. Read [docs/TRUST_MODEL.md](docs/TRUST_MODEL.md) before using ClaimLatch in high-stakes decisions.

## Project status

`0.3.1` adds hardened provenance, core provider invariant enforcement, an OpenAI-compatible proxy, an independent benchmark runner, signed verification receipts, multi-choice proxy verification, structured-output verifier hooks, and guarded application integration examples. Before `1.0`, public APIs and provider behavior may change.

## License

Apache-2.0
