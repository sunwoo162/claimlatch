# Security

Do not include API keys, authorization headers, or private evidence in bug reports.

ClaimLatch sends claim/evidence text to the configured verifier endpoint and claim text to the configured search provider. The optional provenance layer also fetches URLs returned by the evidence provider. Operators are responsible for deciding whether those data and outbound requests may leave their environment.

## Evidence-fetch SSRF boundary

The built-in provenance fetcher blocks literal loopback, private-network, reserved, documentation, multicast, unspecified, and other non-routable IPv4/IPv6 targets, rejects non-HTTP(S) schemes, resolves hostnames before every request, rejects any resolution set containing a non-public address, pins the selected public address for the connection, revalidates redirects, caps response size, and times out requests.

The built-in path fails closed when DNS resolution fails or returns no safe address. Applications that provide a custom `fetchImpl` or custom request transport are responsible for preserving these DNS and egress guarantees. Public or multi-tenant deployments should still put evidence retrieval behind an outbound allowlist, egress proxy, or isolated network sandbox.

## Reverse proxy

`claimlatch-proxy` binds to `127.0.0.1` by default. If an upstream API key is configured in the proxy and the proxy is exposed to untrusted clients without authentication, those clients may be able to consume the upstream account through the proxy. Keep it loopback-only or add an authenticated front door.

For sensitive deployments, provide local implementations of `ClaimExtractor`, `EvidenceProvider`, and `ClaimVerifier` and keep evidence retrieval inside the trusted network boundary.
