import assert from "node:assert/strict";
import test from "node:test";
import { ProvenanceEvidenceProvider, isSafePublicHttpUrl } from "../src/providers/provenance.js";
import { StaticEvidenceProvider } from "../src/providers/static.js";

const claim = { id: "claim_1", text: "Mars is known as the Red Planet.", kind: "fact" as const, importance: "normal" as const };

test("provenance provider binds evidence to fetched document text and hash", async () => {
  const provider = new ProvenanceEvidenceProvider({
    provider: new StaticEvidenceProvider(() => [
      {
        id: "e1",
        claimId: "claim_1",
        title: "Mars",
        url: "https://example.test/mars",
        snippet: "Search snippet",
        sourceType: "primary",
        retrievedAt: "2026-09-28T00:00:00.000Z",
        provider: "fixture",
      },
    ]),
    fetchImpl: (async () =>
      new Response(
        "<html><body><h1>Mars</h1><p>Mars is commonly known as the Red Planet because of its reddish appearance.</p></body></html>",
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      )) as typeof fetch,
  });

  const result = await provider.search(claim);
  assert.equal(result[0]?.provenance?.kind, "retrieved-document");
  assert.match(result[0]?.snippet ?? "", /Mars.*Red Planet/i);
  assert.equal(result[0]?.provenance?.contentSha256?.length, 64);
  assert.equal(typeof result[0]?.provenance?.quoteStart, "number");
});

test("private network evidence URLs are never fetched", async () => {
  let called = false;
  const provider = new ProvenanceEvidenceProvider({
    provider: new StaticEvidenceProvider(() => [
      {
        id: "e1",
        claimId: "claim_1",
        title: "Unsafe",
        url: "http://127.0.0.1:8080/admin",
        snippet: "fallback",
        sourceType: "unknown",
        retrievedAt: "2026-09-28T00:00:00.000Z",
        provider: "fixture",
      },
    ]),
    fetchImpl: (async () => {
      called = true;
      throw new Error("must not be called");
    }) as typeof fetch,
  });

  const result = await provider.search(claim);
  assert.equal(called, false);
  assert.equal(result[0]?.provenance?.kind, "search-snippet");
});

test("public URL filter rejects common private and local targets", () => {
  assert.equal(isSafePublicHttpUrl(new URL("http://localhost/test")), false);
  assert.equal(isSafePublicHttpUrl(new URL("http://10.0.0.1/test")), false);
  assert.equal(isSafePublicHttpUrl(new URL("http://192.168.1.1/test")), false);
  assert.equal(isSafePublicHttpUrl(new URL("http://169.254.169.254/latest/meta-data")), false);
  assert.equal(isSafePublicHttpUrl(new URL("https://example.com/test")), true);
});

test("DNS resolution rejects a public hostname that resolves to a private address", async () => {
  let lookupCalled = false;
  let requestCalled = false;
  const provider = new ProvenanceEvidenceProvider({
    provider: new StaticEvidenceProvider(() => [
      {
        id: "e1",
        claimId: "claim_1",
        title: "DNS rebinding target",
        url: "http://public.example.test/mars",
        snippet: "fallback",
        sourceType: "unknown",
        retrievedAt: "2026-09-28T00:00:00.000Z",
        provider: "fixture",
      },
    ]),
    lookupImpl: async () => {
      lookupCalled = true;
      return [{ address: "127.0.0.1", family: 4 }];
    },
    requestImpl: async () => {
      requestCalled = true;
      return new Response("should not be fetched", { status: 200, headers: { "content-type": "text/plain" } });
    },
  });

  const result = await provider.search(claim);
  assert.equal(lookupCalled, true);
  assert.equal(requestCalled, false);
  assert.equal(result[0]?.provenance?.kind, "search-snippet");
});

test("DNS resolution pins the selected public address for the document request", async () => {
  let lookupCalled = false;
  let requestedAddress: string | undefined;
  const provider = new ProvenanceEvidenceProvider({
    provider: new StaticEvidenceProvider(() => [
      {
        id: "e1",
        claimId: "claim_1",
        title: "Pinned DNS target",
        url: "http://public.example.test/mars",
        snippet: "fallback",
        sourceType: "unknown",
        retrievedAt: "2026-09-28T00:00:00.000Z",
        provider: "fixture",
      },
    ]),
    lookupImpl: async () => {
      lookupCalled = true;
      return [{ address: "93.184.216.34", family: 4 }];
    },
    requestImpl: async (_url: URL, options) => {
      requestedAddress = options.address;
      return new Response("Mars is known as the Red Planet.", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
  });

  const result = await provider.search(claim);
  assert.equal(lookupCalled, true);
  assert.equal(requestedAddress, "93.184.216.34");
  assert.equal(result[0]?.provenance?.kind, "retrieved-document");
});
