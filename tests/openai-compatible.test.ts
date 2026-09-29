import assert from "node:assert/strict";
import test from "node:test";
import { LlmClaimExtractor, LlmClaimVerifier, OpenAICompatibleClient } from "../src/providers/openai-compatible.js";
import type { Evidence } from "../src/types.js";

function fakeFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

test("extractor normalizes model output", async () => {
  const client = new OpenAICompatibleClient({
    apiKey: "test",
    model: "test",
    fetchImpl: fakeFetch({
      claims: [
        { text: "Node.js uses V8.", kind: "fact", importance: "critical" },
        { text: "Version is current.", kind: "current", importance: "normal" },
      ],
    }),
  });
  const extractor = new LlmClaimExtractor(client);
  const claims = await extractor.extract({ question: "q", answer: "a" });

  assert.equal(claims.length, 2);
  assert.equal(claims[0]?.id, "claim_1");
  assert.equal(claims[1]?.kind, "current");
});

test("verifier rejects invented evidence IDs", async () => {
  const client = new OpenAICompatibleClient({
    apiKey: "test",
    model: "test",
    fetchImpl: fakeFetch({
      status: "SUPPORTED",
      reason: "supported",
      evidenceIds: ["real", "invented"],
    }),
  });
  const verifier = new LlmClaimVerifier(client);
  const evidence: Evidence[] = [
    {
      id: "real",
      claimId: "claim_1",
      title: "Source",
      url: "https://example.test",
      snippet: "support",
      sourceType: "primary",
      retrievedAt: "2026-09-28T00:00:00.000Z",
      provider: "test",
    },
  ];
  const result = await verifier.verify({
    claim: { id: "claim_1", text: "A", kind: "fact", importance: "normal" },
    evidence,
  });

  assert.deepEqual(result.evidenceIds, ["real"]);
});


test("decisive verifier status without valid evidence binding is downgraded", async () => {
  const client = new OpenAICompatibleClient({
    model: "test",
    fetchImpl: fakeFetch({ status: "SUPPORTED", reason: "trust me", evidenceIds: ["invented"] }),
  });
  const verifier = new LlmClaimVerifier(client);
  const evidence: Evidence[] = [
    {
      id: "real",
      claimId: "claim_1",
      title: "Source",
      url: "https://example.test",
      snippet: "support",
      sourceType: "primary",
      retrievedAt: "2026-09-28T00:00:00.000Z",
      provider: "test",
    },
  ];
  const result = await verifier.verify({
    claim: { id: "claim_1", text: "A", kind: "fact", importance: "normal" },
    evidence,
  });

  assert.equal(result.status, "UNVERIFIABLE");
});
