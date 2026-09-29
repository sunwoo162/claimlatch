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

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function upstreamFetchSse(frames: string[]): typeof fetch {
  return (async () => new Response(frames.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })) as typeof fetch;
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

test("proxy replays a buffered stream only after every choice passes", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: "This is " } }],
      }),
      sseData({
        id: "chatcmpl_stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: "supported." }, finish_reason: "stop" }],
      }),
      "data: [DONE]\n\n",
    ]),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("x-claimlatch-result"), "pass");
    const body = await response.text();
    assert.match(body, /This is /);
    assert.match(body, /supported\./);
    assert.match(body, /data: \[DONE\]/);
  });
});

test("proxy blocks a buffered stream without releasing any SSE frame", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_blocked_stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: "This is wrong." } }],
      }),
      sseData({
        id: "chatcmpl_blocked_stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      "data: [DONE]\n\n",
    ]),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 422);
    assert.equal(response.headers.get("x-claimlatch-result"), "blocked");
    assert.ok(response.headers.get("content-type") !== "text/event-stream");
    const body = await response.text();
    assert.ok(!/data: /u.test(body));
  });
});

test("proxy fails closed for a truncated or malformed upstream stream", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_truncated_stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: "partial" } }],
      }),
    ]),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 502);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_invalid_upstream_stream");
  });
});

test("proxy verifies every buffered streaming choice", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_multi_stream",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: { role: "assistant", content: "First supported." } },
          { index: 1, delta: { role: "assistant", content: "Second supported." } },
        ],
      }),
      sseData({
        id: "chatcmpl_multi_stream",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: {}, finish_reason: "stop" },
          { index: 1, delta: {}, finish_reason: "stop" },
        ],
      }),
      "data: [DONE]\n\n",
    ]),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, n: 2, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-claimlatch-claims"), "2");
  });
});

test("proxy fails closed when a buffered stream exceeds its size limit", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    maxBufferedResponseBytes: 1_024,
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_large_stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: "x".repeat(2_000) } }],
      }),
      "data: [DONE]\n\n",
    ]),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 502);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_invalid_upstream_stream");
  });
});

test("proxy fails closed when a buffered stream exceeds its choice limit", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    maxBufferedChoices: 1,
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_choice_limit",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: { role: "assistant", content: "First supported." } },
          { index: 1, delta: { role: "assistant", content: "Second supported." } },
        ],
      }),
      "data: [DONE]\n\n",
    ]),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, n: 2, messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 502);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_invalid_upstream_stream");
  });
});

test("proxy aborts an upstream request that exceeds its configured timeout", async () => {
  let upstreamSignal: AbortSignal | undefined;
  let upstreamAbortReason: string | undefined;
  const upstreamFetchWithTimeout = (async (_input, init) => {
    upstreamSignal = init?.signal ?? undefined;
    init?.signal?.addEventListener("abort", () => {
      const reason = init?.signal?.reason as { name?: unknown } | undefined;
      upstreamAbortReason = typeof reason?.name === "string" ? reason.name : undefined;
    }, { once: true });
    await new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    });
    throw new Error("unreachable");
  }) as typeof fetch;

  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamTimeoutMs: 20,
    fetchImpl: upstreamFetchWithTimeout,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 504);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_upstream_timeout");
    assert.equal(upstreamSignal?.aborted, true);
    assert.equal(upstreamAbortReason, "TimeoutError");
  });
});

test("proxy fails closed when an upstream transport ignores an expired signal", async () => {
  const slowIgnoringFetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return new Response(JSON.stringify({
      id: "chatcmpl_late",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "This is late." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamTimeoutMs: 20,
    fetchImpl: slowIgnoringFetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 504);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_upstream_timeout");
  });
});

test("proxy aborts upstream buffering when the client disconnects", async () => {
  let upstreamStarted = false;
  let upstreamAborted = false;
  let upstreamAbortReason: string | undefined;
  const upstreamFetchWithHangingStream = (async (_input, init) => {
    upstreamStarted = true;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData({
          id: "chatcmpl_disconnect",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { role: "assistant", content: "partial" } }],
        })));
        init?.signal?.addEventListener("abort", () => {
          upstreamAborted = true;
          const reason = init?.signal?.reason as { name?: unknown } | undefined;
          upstreamAbortReason = typeof reason?.name === "string" ? reason.name : undefined;
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      },
      pull() {},
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;

  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamTimeoutMs: 250,
    fetchImpl: upstreamFetchWithHangingStream,
  }, async (url) => {
    const clientController = new AbortController();
    const responsePromise = fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "question" }] }),
      signal: clientController.signal,
    });

    for (let attempt = 0; attempt < 100 && !upstreamStarted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(upstreamStarted, true);
    const clientAbortStartedAt = Date.now();
    clientController.abort();
    await assert.rejects(responsePromise);

    for (let attempt = 0; attempt < 100 && !upstreamAborted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(upstreamAborted, true);
    assert.equal(upstreamAbortReason, "AbortError");
    assert.ok(Date.now() - clientAbortStartedAt < 1_000);
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
