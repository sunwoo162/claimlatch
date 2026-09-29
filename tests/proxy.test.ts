import assert from "node:assert/strict";
import test from "node:test";
import { ClaimLatch } from "../src/gate.js";
import { createOpenAIProxy } from "../src/proxy.js";
import type { ClaimExtractor, ClaimVerifier, EvidenceProvider } from "../src/types.js";
import type { OpenAIProxyOptions } from "../src/proxy.js";

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

function upstreamFetchPayload(payload: unknown, headers: HeadersInit = { "content-type": "application/json" }): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers,
  })) as typeof fetch;
}

function upstreamFetch(answer: string): typeof fetch {
  return upstreamFetchPayload({
    id: "chatcmpl_test",
    object: "chat.completion",
    choices: [{ message: { role: "assistant", content: answer }, finish_reason: "stop", index: 0 }],
  });
}

async function withProxyOptions(
  options: OpenAIProxyOptions,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const proxy = createOpenAIProxy(options);
  await proxy.listen(0, "127.0.0.1");
  const address = proxy.server.address();
  if (!address || typeof address === "string") throw new Error("missing proxy address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await proxy.close();
  }
}

async function withProxyPayload(
  payload: unknown,
  run: (url: string) => Promise<void>,
  responseHeaders?: HeadersInit,
): Promise<void> {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: upstreamFetchPayload(payload, responseHeaders),
  }, run);
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

test("proxy verifies and releases every textual choice", async () => {
  await withProxyPayload({
    id: "chatcmpl_multi",
    object: "chat.completion",
    choices: [
      { message: { role: "assistant", content: "First supported answer." }, finish_reason: "stop", index: 0 },
      { message: { role: "assistant", content: [{ type: "text", text: "Second supported answer." }] }, finish_reason: "stop", index: 1 },
    ],
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 2, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-claimlatch-result"), "pass");
    assert.equal(response.headers.get("x-claimlatch-claims"), "2");
    const body = await response.json() as { choices?: unknown[] };
    assert.equal(body.choices?.length, 2);
  });
});

test("proxy blocks the whole completion when any textual choice is contradicted", async () => {
  await withProxyPayload({
    id: "chatcmpl_multi",
    object: "chat.completion",
    choices: [
      { message: { role: "assistant", content: "First supported answer." }, finish_reason: "stop", index: 0 },
      { message: { role: "assistant", content: "Second wrong answer." }, finish_reason: "stop", index: 1 },
    ],
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 2, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 422);
    assert.equal(response.headers.get("x-claimlatch-result"), "blocked");
    const body = await response.json() as { claimlatchReports?: unknown[] };
    assert.equal(body.claimlatchReports?.length, 2);
  });
});

test("proxy fails closed when an upstream choice is malformed", async () => {
  await withProxyPayload({
    id: "chatcmpl_malformed",
    object: "chat.completion",
    choices: [null],
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 502);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_missing_assistant_text");
  });
});

test("proxy forwards compatible request headers and configured authentication", async () => {
  let capturedHeaders: Headers | undefined;
  await withProxyOptions({
      gate: fixtureGate(),
      upstreamBaseUrl: "https://upstream.example/v1",
      upstreamApiKey: "server-key",
      fetchImpl: (async (_input, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({
          id: "chatcmpl_headers",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "Header-compatible answer." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    }, async (url) => {
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer client-key",
          accept: "application/json",
          "openai-organization": "org_test",
          "openai-project": "proj_test",
          "x-request-id": "request_test",
          connection: "keep-alive",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
      });
      assert.equal(response.status, 200);
  });

  assert.equal(capturedHeaders?.get("authorization"), "Bearer server-key");
  assert.equal(capturedHeaders?.get("accept"), "application/json");
  assert.equal(capturedHeaders?.get("openai-organization"), "org_test");
  assert.equal(capturedHeaders?.get("openai-project"), "proj_test");
  assert.equal(capturedHeaders?.get("x-request-id"), "request_test");
  assert.equal(capturedHeaders?.get("connection"), null);
});

test("proxy preserves compatible upstream response headers on pass", async () => {
  await withProxyPayload({
    id: "chatcmpl_response_headers",
    object: "chat.completion",
    choices: [{ message: { role: "assistant", content: "Response-header-compatible answer." } }],
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-claimlatch-result"), "pass");
    assert.equal(response.headers.get("x-request-id"), "resp_test");
    assert.equal(response.headers.get("x-ratelimit-limit-requests"), "10");
  }, {
    "content-type": "application/json",
    "x-request-id": "resp_test",
    "x-ratelimit-limit-requests": "10",
    connection: "close",
  });
});
