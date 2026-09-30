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
- Frozen human-authored independent-label benchmark with train/dev/test splits
- False-pass / false-block metrics
- Ed25519-signed verification receipt API
- Runnable guarded-application integration example

## V0.3 — hardened delivery and operations (implemented)

- DNS resolution and public-IP pinning before outbound document requests
- Cross-source contradiction detection
- Page-level PDF provenance with page-local quote offsets
- Signed receipt persistence, verification CLI, and key rotation support
- Buffered multi-choice, streaming, structured-output, and multimodal proxy verification
- Provider compatibility profiles for hosted OpenAI-compatible endpoints
- Expanded 200-case independent benchmark with balanced train/dev/test splits
- Credential-free benchmark manifest validation in local scripts and CI
- Opt-in calibrated verification-status confidence with offline isotonic fitting, evaluation metrics, and CLI profile generation
- Credential-free calibration and evaluation dataset validation before profile fitting
- Signed receipt validation and package-root exports for confidence/calibration provenance
- Independently labelled confidence calibration fixture with committed generated evaluation metrics
- Credential-free Azure-style, hosted Gemini, and OpenRouter proxy wire-contract tests
- Next.js App Router Fetch-native route handler example with explicit Node.js runtime
- Remix loader/action route module example using the Fetch-native guarded handler
- Cloudflare Worker Fetch-native integration example
- Express route adapter example without a core framework dependency
- Fastify route adapter example without a core framework dependency
- Hono route adapter example without a core framework dependency
- SvelteKit route adapter example without a core framework dependency
- AWS Lambda HTTP API payload v2 adapter example without an AWS SDK dependency
- Moonshot OpenAI-compatible proxy provider profile with contract coverage
- Koa route adapter example without a core framework dependency
- Baidu Qianfan v2 OpenAI-compatible proxy provider profile with model-list contract coverage

## Next

- Continue adding provider-specific proxy compatibility tests and examples as remaining upstream contracts are verified
- Continue adding framework-oriented integration examples while keeping the core package dependency-light
- Expand the benchmark only with independently sourced labels, provenance, and manifest updates

## Explicitly not promised

- A universal "87% trustworthy" score
- A claim that one LLM judge solves hallucination
- Hidden chain-of-thought based judgments
- Universal OpenAI API compatibility
