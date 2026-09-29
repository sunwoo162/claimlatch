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

test("proxy releases a streaming tool call only through an explicit verifier", async () => {
  let verifierCalled = false;
  let verifiedChoice: unknown;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    structuredOutputVerifier: {
      async verify({ question, choice, stream }) {
        verifierCalled = true;
        verifiedChoice = choice;
        assert.equal(question, "question");
        assert.equal(stream, true);
        return fixtureGate().verify({ question, answer: "The tool call is verified." });
      },
    },
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_stream_tool_call",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: "" },
            }],
          },
        }],
      }),
      sseData({
        id: "chatcmpl_stream_tool_call",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"city":"Seoul"}' } }],
          },
          finish_reason: "tool_calls",
        }],
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
    assert.equal(response.headers.get("x-claimlatch-result"), "pass");
    const body = await response.text();
    assert.match(body, /tool_calls/);
    assert.match(body, /Seoul/);
  });

  assert.equal(verifierCalled, true);
  const message = (verifiedChoice as { message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }).message;
  assert.equal(message?.tool_calls?.[0]?.function?.arguments, '{"city":"Seoul"}');
});

test("proxy fails closed for a streaming structured output without a verifier", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_stream_unverified_tool_call",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup" } }],
          },
        }],
      }),
      sseData({
        id: "chatcmpl_stream_unverified_tool_call",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
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
    const body = await response.text();
    assert.ok(!body.includes("chatcmpl_stream_unverified_tool_call"));
    assert.match(body, /claimlatch_missing_assistant_text/);
  });
});

test("proxy releases streaming multimodal content only through an explicit verifier", async () => {
  let verifiedChoice: unknown;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    structuredOutputVerifier: {
      async verify({ choice, stream }) {
        assert.equal(stream, true);
        verifiedChoice = choice;
        return fixtureGate().verify({ question: "question", answer: "The multimodal output is verified." });
      },
    },
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_stream_multimodal",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            content: [{ type: "text", text: "A chart" }],
          },
        }],
      }),
      sseData({
        id: "chatcmpl_stream_multimodal",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            content: [{ type: "image_url", image_url: { url: "https://example.test/chart.png" } }],
          },
          finish_reason: "stop",
        }],
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
    assert.match(await response.text(), /image_url/);
  });

  const message = (verifiedChoice as { message?: { content?: unknown[] } }).message;
  assert.deepEqual(message?.content, [
    { type: "text", text: "A chart" },
    { type: "image_url", image_url: { url: "https://example.test/chart.png" } },
  ]);
});

test("proxy fails closed when a streaming structured verifier throws", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    structuredOutputVerifier: {
      async verify() {
        throw new Error("streaming structured verifier unavailable");
      },
    },
    fetchImpl: upstreamFetchSse([
      sseData({
        id: "chatcmpl_stream_structured_error",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup" } }],
          },
          finish_reason: "tool_calls",
        }],
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
    assert.equal(body.error?.code, "claimlatch_structured_output_verifier_error");
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

test("proxy fails closed when a non-streaming assistant output mixes text and multimodal parts", async () => {
  await withProxyPayload({
    id: "chatcmpl_mixed_multimodal",
    object: "chat.completion",
    choices: [{
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "This answer is supported." },
          { type: "image_url", image_url: { url: "https://example.test/image.png" } },
        ],
      },
    }],
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

test("proxy fails closed when a non-streaming assistant output includes tool calls", async () => {
  await withProxyPayload({
    id: "chatcmpl_tool_call",
    object: "chat.completion",
    choices: [{
      message: {
        role: "assistant",
        content: "This answer is supported.",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: "{}" },
        }],
      },
    }],
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

test("proxy releases a structured output only through an explicit verifier", async () => {
  let verifierCalled = false;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    structuredOutputVerifier: {
      async verify({ question, choice, stream }) {
        verifierCalled = true;
        assert.equal(question, "question");
        assert.equal(stream, false);
        const message = (choice as { message?: { tool_calls?: unknown[] } }).message;
        assert.equal(message?.tool_calls?.length, 1);
        return fixtureGate().verify({ question, answer: "The structured tool call is verified." });
      },
    },
    fetchImpl: upstreamFetchPayload({
      id: "chatcmpl_verified_tool_call",
      object: "chat.completion",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: "{}" },
          }],
        },
      }],
    }),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-claimlatch-result"), "pass");
  });
  assert.equal(verifierCalled, true);
});

test("proxy fails closed when the structured output verifier throws", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    structuredOutputVerifier: {
      async verify() {
        throw new Error("structured verifier unavailable");
      },
    },
    fetchImpl: upstreamFetchPayload({
      id: "chatcmpl_structured_error",
      object: "chat.completion",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
        },
      }],
    }),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 502);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_structured_output_verifier_error");
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

test("proxy supports provider-specific upstream API key headers", async () => {
  let capturedHeaders: Headers | undefined;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamApiKey: "provider-key",
    upstreamApiKeyHeader: "api-key",
    fetchImpl: (async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_provider_auth",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Provider-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer client-key",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedHeaders?.get("api-key"), "provider-key");
  assert.equal(capturedHeaders?.get("authorization"), null);
});

test("proxy supports provider-specific upstream chat completions paths and query parameters", async () => {
  let capturedUrl: string | undefined;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://resource.example",
    upstreamChatCompletionsPath: "/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
    fetchImpl: (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({
        id: "chatcmpl_provider_path",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Path-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(
    capturedUrl,
    "https://resource.example/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
  );
});

test("proxy supports a custom provider compatibility profile", async () => {
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://provider.example",
    upstreamApiKey: "profile-key",
    upstreamApiKeyHeader: "x-api-key",
    upstreamChatCompletionsPath: "/v1/chat/completions?profile=custom",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_provider_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Profile-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer client-key",
        "x-provider-request-id": "profile-request",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://provider.example/v1/chat/completions?profile=custom");
  assert.equal(capturedHeaders?.get("x-api-key"), "profile-key");
  assert.equal(capturedHeaders?.get("authorization"), null);
  assert.equal(capturedHeaders?.get("x-provider-request-id"), "profile-request");
});

test("proxy rejects an absolute upstream chat completions path configuration", () => {
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamChatCompletionsPath: "https://evil.example/chat/completions",
  }), /relative HTTP path/);
});

test("proxy rejects malformed upstream base URL configuration", () => {
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "upstream.example/v1",
  }), /absolute HTTP URL/);
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://user:password@upstream.example/v1",
  }), /credentials/);
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1?api-version=1",
  }), /query or fragment/);
});

test("proxy rejects restricted upstream API key header configuration", () => {
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamApiKeyHeader: "content-type",
  }), /restricted proxy header/);
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
    assert.equal(response.headers.get("x-ms-request-id"), "ms_req_test");
    assert.equal(response.headers.get("x-ms-region"), "koreacentral");
    assert.equal(response.headers.get("x-goog-request-id"), "goog_req_test");
    assert.equal(response.headers.get("x-amzn-requestid"), "amzn_req_test");
    assert.equal(response.headers.get("anthropic-ratelimit-requests-limit"), "10");
  }, {
    "content-type": "application/json",
    "x-request-id": "resp_test",
    "x-ratelimit-limit-requests": "10",
    "x-ms-request-id": "ms_req_test",
    "x-ms-region": "koreacentral",
    "x-goog-request-id": "goog_req_test",
    "x-amzn-requestid": "amzn_req_test",
    "anthropic-ratelimit-requests-limit": "10",
    connection: "close",
  });
});
