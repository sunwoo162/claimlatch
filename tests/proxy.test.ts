import assert from "node:assert/strict";
import test from "node:test";
import { ClaimLatch } from "../src/gate.js";
import { createOpenAIProxy } from "../src/proxy.js";
import type { ClaimExtractor, ClaimVerifier, EvidenceProvider } from "../src/types.js";

function fixtureGate(): ClaimLatch {
  const extractor: ClaimExtractor = {
    async extract({ answer }) {
      return [{ id: "claim_1", text: answer, kind: "fact", importance: "critical" }];
    },
  };
  const evidenceProvider: EvidenceProvider = {
    async search(claim) {
      return [{
        id: "e1",
        claimId: claim.id,
        title: "fixture",
        url: "https://example.test/source",
        snippet: "fixture",
        sourceType: "primary",
        retrievedAt: "2026-09-28T00:00:00.000Z",
        provider: "fixture",
      }];
    },
  };
  const verifier: ClaimVerifier = {
    async verify({ claim, evidence }) {
      const status = claim.text.includes("wrong") ? "CONTRADICTED" as const : "SUPPORTED" as const;
      return { claim, status, reason: "fixture", evidenceIds: ["e1"], evidence };
    },
  };
  return new ClaimLatch({ extractor, evidenceProvider, verifier });
}

function upstreamFetch(answer: string): typeof fetch {
  return (async () => new Response(JSON.stringify({
    id: "chatcmpl_test",
    object: "chat.completion",
    choices: [{ message: { role: "assistant", content: answer }, finish_reason: "stop", index: 0 }],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

async function withProxy(answer: string, run: (url: string) => Promise<void>): Promise<void> {
  const proxy = createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: upstreamFetch(answer),
  });
  await proxy.listen(0, "127.0.0.1");
  const address = proxy.server.address();
  if (!address || typeof address === "string") throw new Error("missing proxy address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await proxy.close();
  }
}

test("proxy releases an upstream completion only after the gate passes", async () => {
  await withProxy("This is supported.", async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "x", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-claimlatch-result"), "pass");
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    assert.equal(body.choices?.[0]?.message?.content, "This is supported.");
  });
});

test("proxy blocks a contradicted completion with a structured 422", async () => {
  await withProxy("This answer is wrong.", async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "x", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 422);
    assert.equal(response.headers.get("x-claimlatch-result"), "blocked");
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_blocked");
  });
});

test("proxy rejects streaming because pre-release verification requires buffering", async () => {
  await withProxy("supported", async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_streaming_unsupported");
  });
});
