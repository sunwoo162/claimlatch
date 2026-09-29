# Trust model

ClaimLatch is not a truth oracle.

A PASS means the configured pipeline found no policy violation under the evidence it collected. It does not prove that the answer is globally true, complete, unbiased, or safe.

## What ClaimLatch tries to improve

- Makes factual claims explicit instead of hiding them inside fluent prose.
- Binds verifier decisions to concrete evidence IDs.
- Can bind evidence to fetched source quotes and content hashes instead of search snippets alone.
- Separates evidence coverage from truth probability.
- Revalidates plugin output at the core boundary.
- Makes the release rule deterministic and inspectable.
- Allows applications to fail closed instead of silently shipping unverifiable claims.

## What can still fail

- The extractor can miss a claim entirely.
- Search can miss the best source or rank a misleading source highly.
- An official-source domain policy can restrict search, but domain ownership and publisher correctness still require operator judgment.
- A retrieved document can have changed since the answer was generated.
- HTML-to-text extraction can lose table structure, footnotes, qualifiers, or surrounding context.
- PDF text extraction can lose layout, columns, tables, images, annotations, and reading order.
- Quote selection is heuristic and can choose a relevant-looking but non-decisive passage.
- The verifier can misclassify entailment or contradiction.
- Cross-source contradiction detection depends on the verifier correctly identifying supporting and contradicting evidence IDs.
- A primary source can itself be wrong, stale, compromised, or inappropriate for the claim.
- Policies can be configured too loosely.
- A PASS says nothing about omitted facts that were never extracted.

## Provenance is auditability, not authority

`retrieved-document` means ClaimLatch fetched the source URL, normalized the text, selected a quote, and stored a SHA-256 of that normalized text. It does not cryptographically prove publisher identity beyond the transport guarantees of the URL fetch, nor does it prove that the quoted publisher is correct.

For PDFs, the normalized text is extracted page by page and the selected quote includes a 1-based page number plus offsets within that page. Scanned PDFs without an embedded text layer fall back to search-snippet provenance because OCR is not silently performed.

When a verifier identifies both supporting and contradicting evidence, ClaimLatch compares their normalized source URLs. Evidence from distinct sources creates a deterministic `CROSS_SOURCE_CONTRADICTION` policy violation by default. This does not establish which source is correct; it prevents an unresolved disagreement from silently becoming a PASS.

## Network boundary

The built-in provenance fetcher rejects non-HTTP(S) URLs, common literal localhost/private IPv4 targets, local hostnames, IPv4-mapped IPv6, and common private/link-local IPv6 ranges. Before each document request it resolves the hostname, rejects the entire result if any address is non-public, and pins the selected public address for the connection. It also validates redirects, limits response size, and applies a timeout.

Tavily search can be scoped to fixed official domains or to domains returned by a claim-aware resolver. The provider sends the policy to the search API and filters returned URLs again; resolver errors and empty results fail closed without an unrestricted search.

DNS failures and empty or unsafe resolution results fail closed. An optional outbound allowlist can restrict document hydration to exact hosts or their subdomains and selected ports; it is rechecked before every redirect. Custom fetch or request implementations must provide equivalent DNS pinning and transport protections. For public multi-tenant services, run document retrieval in a network sandbox or enforce an outbound allowlist/proxy.

## Proxy boundary

The reverse proxy buffers the full completion before verification. It intentionally rejects streaming in V0.2. Tool-call-only/model-specific payloads are not yet a compatibility target.

The proxy binds to loopback by default. Exposing it publicly can turn configured upstream credentials into a relay if authentication is not added by the operator.

## High-stakes deployments

ClaimLatch can create deterministic Ed25519-signed verification receipts. The receipt authenticates the exact report payload and the embedded public key; it does not prove that the report is factually correct or that its evidence source is trustworthy. For high-stakes use, add domain-specific primary-source providers, human review, larger independent benchmarks, persistent storage with key rotation, and network isolation. Do not use a generic PASS as the sole basis for medical, legal, financial, safety-critical, or other consequential decisions.
