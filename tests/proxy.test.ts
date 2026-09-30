import assert from "node:assert/strict";
import test from "node:test";
import { ClaimLatch } from "../src/gate.js";
import { createOpenAIProxy } from "../src/proxy.js";
import { resolveProxyProviderConfiguration } from "../src/proxy-cli-options.js";
import { PROXY_PROVIDER_PROFILE_NAMES } from "../src/proxy-profiles.js";
import type { ClaimExtractor, ClaimVerifier, EvidenceProvider } from "../src/types.js";
import type { OpenAIProxyOptions } from "../src/proxy.js";
import type { ProxyProviderProfileName } from "../src/proxy-profiles.js";

const HOSTED_PROFILE_BASE_URLS: Record<Exclude<ProxyProviderProfileName, "azure" | "openrouter">, string> = {
  ai21: "https://api.ai21.com/studio/v1",
  cerebras: "https://api.cerebras.ai/v1",
  chutes: "https://llm.chutes.ai/v1",
  cohere: "https://api.cohere.ai/compatibility/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  deepseek: "https://api.deepseek.com",
  fireworks: "https://api.fireworks.ai/inference/v1",
  friendli: "https://api.friendli.ai/serverless/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  huggingface: "https://router.huggingface.co/v1",
  hunyuan: "https://api.hunyuan.cloud.tencent.com/v1",
  minimax: "https://api.minimax.io/v1",
  mistral: "https://api.mistral.ai/v1",
  moonshot: "https://api.moonshot.ai/v1",
  nebius: "https://api.tokenfactory.nebius.com/v1",
  novita: "https://api.novita.ai/openai/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  openai: "https://api.openai.com/v1",
  perplexity: "https://api.perplexity.ai/router/v1",
  poe: "https://api.poe.com/v1",
  qianfan: "https://qianfan.baidubce.com/v2",
  sambanova: "https://api.sambanova.ai/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  stepfun: "https://api.stepfun.ai/v1",
  together: "https://api.together.xyz/v1",
  tokenhub: "https://tokenhub.tencentmaas.com/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  xai: "https://api.x.ai/v1",
  zai: "https://api.z.ai/api/paas/v4",
} as const;

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

test("proxy forwards OpenAI-compatible model listing without invoking the gate", async () => {
  let capturedUrl: string | undefined;
  let capturedMethod: string | undefined;
  let capturedAuthorization: string | null | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: (async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = init?.method;
      capturedAuthorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ object: "list", data: [{ id: "fixture-model", object: "model" }] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "openai-processing-ms": "4",
        },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models?limit=1`, {
      headers: { authorization: "Bearer client-key" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("openai-processing-ms"), "4");
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "fixture-model", object: "model" }],
    });
    assert.equal(capturedUrl, "https://upstream.example/v1/models?limit=1");
    assert.equal(capturedMethod, "GET");
    assert.equal(capturedAuthorization, "Bearer client-key");
  });
});

test("proxy applies provider-specific model path and authentication settings", async () => {
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example",
    upstreamApiKey: "provider-key",
    upstreamApiKeyHeader: "x-api-key",
    upstreamModelsPath: "/v1/models?scope=active",
    fetchImpl: (async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/models?limit=1`, {
      headers: { authorization: "Bearer client-key" },
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://upstream.example/v1/models?scope=active&limit=1");
  assert.equal(capturedHeaders?.get("x-api-key"), "provider-key");
  assert.equal(capturedHeaders?.get("authorization"), null);
});

test("proxy forwards encoded model retrieval requests through the configured model path", async () => {
  let capturedUrl: string | undefined;
  let capturedMethod: string | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example",
    upstreamModelsPath: "/v1/models?scope=active",
    fetchImpl: (async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = init?.method;
      return new Response(JSON.stringify({ id: "org/model", object: "model" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models/org%2Fmodel?verbose=true`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "org/model", object: "model" });
  });

  assert.equal(capturedUrl, "https://upstream.example/v1/models/org%2Fmodel?scope=active&verbose=true");
  assert.equal(capturedMethod, "GET");
});

test("proxy does not treat model path traversal as a model retrieval route", async () => {
  let fetchCalls = 0;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response("unexpected", { status: 200 });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models/%2E%2E`);
    assert.equal(response.status, 404);
  });
  assert.equal(fetchCalls, 0);
});

test("proxy fails closed when the upstream model listing exceeds the response limit", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    maxBufferedResponseBytes: 1_024,
    fetchImpl: (async () => new Response(`{"data":"${"x".repeat(2_000)}"}`, {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models`);
    assert.equal(response.status, 502);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "claimlatch_invalid_upstream_models_response");
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

test("proxy injects configured upstream request headers with server precedence", async () => {
  let capturedHeaders: Headers | undefined;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamRequestHeaders: {
      "x-provider-tenant": "server-tenant",
      "x-provider-version": "2026-09",
    },
    fetchImpl: (async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_static_headers",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Static header-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-provider-tenant": "client-tenant",
        "x-provider-version": "client-version",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedHeaders?.get("x-provider-tenant"), "server-tenant");
  assert.equal(capturedHeaders?.get("x-provider-version"), "2026-09");
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

test("proxy forwards OpenRouter attribution headers to the upstream request", async () => {
  let capturedHeaders: Headers | undefined;
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://openrouter.ai/api/v1",
    upstreamApiKey: "openrouter-key",
    upstreamRequestHeaders: {
      "HTTP-Referer": "https://claimlatch.example",
      "X-Title": "ClaimLatch",
    },
    fetchImpl: (async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_openrouter_attribution",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "OpenRouter-compatible answer." } }],
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

  assert.equal(capturedHeaders?.get("http-referer"), "https://claimlatch.example");
  assert.equal(capturedHeaders?.get("x-title"), "ClaimLatch");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer openrouter-key");
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

test("Azure provider profile sends its deployment path and api-key header", async () => {
  const env = {
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "azure",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "https://claimlatch-resource.openai.azure.com",
  };
  const profile = resolveProxyProviderConfiguration(env);
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedBody: string | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "azure-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({
        id: "chatcmpl_azure_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Azure-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(
    capturedUrl,
    "https://claimlatch-resource.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
  );
  assert.equal(capturedHeaders?.get("api-key"), "azure-key");
  assert.equal(capturedHeaders?.get("authorization"), null);
  assert.equal(JSON.parse(capturedBody ?? "{}").model, "gpt-4o-mini");
});

test("Azure provider profile sends its model-list path and api-key header", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "azure",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "https://claimlatch-resource.openai.azure.com",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "azure-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [{ id: "gpt-4o-mini", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models?limit=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "gpt-4o-mini", object: "model" }],
    });
  });

  assert.equal(
    capturedUrl,
    "https://claimlatch-resource.openai.azure.com/openai/models?api-version=2024-10-21&limit=1",
  );
  assert.equal(capturedHeaders?.get("api-key"), "azure-key");
  assert.equal(capturedHeaders?.get("authorization"), null);
});

test("DashScope provider profile sends its model-list path and bearer header", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "dashscope",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "dashscope-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [{ id: "qwen-plus", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models?limit=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "qwen-plus", object: "model" }],
    });
  });

  assert.equal(capturedUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/models?limit=1");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer dashscope-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("Qianfan provider profile sends its model-list path and bearer header", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "qianfan",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "qianfan-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [{ id: "ernie-5.0", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models?limit=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "ernie-5.0", object: "model" }],
    });
  });

  assert.equal(capturedUrl, "https://qianfan.baidubce.com/v2/models?limit=1");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer qianfan-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("TokenHub provider profile sends its model-list path and bearer header", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "tokenhub",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "tokenhub-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [{ id: "hy4-preview", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models?limit=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "hy4-preview", object: "model" }],
    });
  });

  assert.equal(capturedUrl, "https://tokenhub.tencentmaas.com/v1/models?limit=1");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer tokenhub-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("Novita provider profile sends its model-list path and bearer header", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "novita",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "novita-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [{ id: "openai/gpt-oss-120b", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models?limit=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "openai/gpt-oss-120b", object: "model" }],
    });
  });

  assert.equal(capturedUrl, "https://api.novita.ai/openai/v1/models?limit=1");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer novita-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("Chutes provider profile sends its model-list path and bearer header", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "chutes",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "chutes-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [{ id: "google/gemma-4-31B-turbo-TEE", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "google/gemma-4-31B-turbo-TEE", object: "model" }],
    });
  });

  assert.equal(capturedUrl, "https://llm.chutes.ai/v1/models");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer chutes-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("Poe provider profile sends its model-list path and bearer header", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "poe",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "poe-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ object: "list", data: [{ id: "Claude-Sonnet-4.6", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/models`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: "list",
      data: [{ id: "Claude-Sonnet-4.6", object: "model" }],
    });
  });

  assert.equal(capturedUrl, "https://api.poe.com/v1/models");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer poe-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("StepFun provider profile sends the OpenAI-compatible bearer contract", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "stepfun",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "stepfun-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_stepfun_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "StepFun-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "step-3.7-flash", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://api.stepfun.ai/v1/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer stepfun-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("AI21 provider profile sends the OpenAI-compatible bearer contract", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "ai21",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "ai21-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_ai21_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "AI21-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "jamba-mini", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://api.ai21.com/studio/v1/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer ai21-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("hosted Gemini provider profile sends the OpenAI-compatible bearer contract", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "gemini",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "gemini-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_gemini_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Gemini-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer gemini-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("Z.AI provider profile sends the OpenAI-compatible bearer contract", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "zai",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "zai-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_zai_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Z.AI-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-5.3", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://api.z.ai/api/paas/v4/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer zai-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("MiniMax provider profile sends the OpenAI-compatible bearer contract", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "minimax",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "minimax-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_minimax_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "MiniMax-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3.1-Flash-Preview", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://api.minimax.io/v1/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer minimax-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("Tencent Hunyuan provider profile sends the OpenAI-compatible bearer contract", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "hunyuan",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "hunyuan-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_hunyuan_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Hunyuan-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "hunyuan-turbos-latest", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://api.hunyuan.cloud.tencent.com/v1/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer hunyuan-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("Volcengine Ark provider profile sends the OpenAI-compatible bearer contract", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "volcengine",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "volcengine-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_volcengine_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Volcengine Ark-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "doubao-seed-2-1-pro-260628", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer volcengine-key");
  assert.equal(capturedHeaders?.get("api-key"), null);
});

test("OpenRouter provider profile forwards attribution headers with bearer auth", async () => {
  const profile = resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "openrouter",
    CLAIMLATCH_PROXY_OPENROUTER_SITE_URL: "https://claimlatch.example",
    CLAIMLATCH_PROXY_OPENROUTER_APP_NAME: "ClaimLatch",
  });
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  await withProxyOptions({
    gate: fixtureGate(),
    ...profile,
    upstreamApiKey: "openrouter-key",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: "chatcmpl_openrouter_profile",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "OpenRouter-compatible answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(capturedHeaders?.get("authorization"), "Bearer openrouter-key");
  assert.equal(capturedHeaders?.get("http-referer"), "https://claimlatch.example");
  assert.equal(capturedHeaders?.get("x-title"), "ClaimLatch");
});

test("hosted provider profiles preserve their resolver contracts through the proxy", async () => {
  const expectedHostedProfiles = PROXY_PROVIDER_PROFILE_NAMES.filter(
    (profileName) => profileName !== "azure" && profileName !== "openrouter",
  );
  assert.deepEqual(Object.keys(HOSTED_PROFILE_BASE_URLS).sort(), [...expectedHostedProfiles].sort());

  for (const [profileName, expectedBaseUrl] of Object.entries(HOSTED_PROFILE_BASE_URLS)) {
    const profile = resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: profileName,
    });
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;

    await withProxyOptions({
      gate: fixtureGate(),
      ...profile,
      upstreamApiKey: `${profileName}-key`,
      fetchImpl: (async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({
          id: `chatcmpl_${profileName}`,
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "Hosted-compatible answer." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    }, async (url) => {
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "question" }] }),
      });
      assert.equal(response.status, 200);
    });

    assert.equal(capturedUrl, `${expectedBaseUrl}/chat/completions`);
    assert.equal(capturedHeaders?.get("authorization"), `Bearer ${profileName}-key`);
    assert.equal(capturedHeaders?.get("api-key"), null);
  }
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
    assert.equal(response.headers.get("apim-request-id"), "apim_req_test");
    assert.equal(response.headers.get("x-goog-request-id"), "goog_req_test");
    assert.equal(response.headers.get("x-amzn-requestid"), "amzn_req_test");
    assert.equal(response.headers.get("anthropic-ratelimit-requests-limit"), "10");
  }, {
    "content-type": "application/json",
    "x-request-id": "resp_test",
    "x-ratelimit-limit-requests": "10",
    "x-ms-request-id": "ms_req_test",
    "x-ms-region": "koreacentral",
    "apim-request-id": "apim_req_test",
    "x-goog-request-id": "goog_req_test",
    "x-amzn-requestid": "amzn_req_test",
    "anthropic-ratelimit-requests-limit": "10",
    connection: "close",
  });
});

test("proxy forwards explicitly configured provider response headers", async () => {
  await withProxyOptions({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamResponseHeaderNames: ["x-vendor-request-id"],
    upstreamResponseHeaderPrefixes: ["x-vendor-rate-"],
    fetchImpl: upstreamFetchPayload({
      id: "chatcmpl_custom_response_headers",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "Custom response headers." } }],
    }, {
      "content-type": "application/json",
      "x-vendor-request-id": "vendor-request",
      "x-vendor-rate-limit": "20",
      "x-vendor-private": "not-forwarded",
    }),
  }, async (url) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "question" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-vendor-request-id"), "vendor-request");
    assert.equal(response.headers.get("x-vendor-rate-limit"), "20");
    assert.equal(response.headers.get("x-vendor-private"), null);
  });
});

test("proxy rejects unsafe configured response headers", () => {
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamResponseHeaderNames: ["content-length"],
  }), /restricted proxy response header/);
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamResponseHeaderPrefixes: ["bad prefix"],
  }), /valid HTTP header prefix/);
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamResponseHeaderNames: ["x-vendor-request-id", "X-Vendor-Request-Id"],
  }), /duplicate proxy response header name/);
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamResponseHeaderPrefixes: ["x-vendor-rate-", "X-Vendor-Rate-"],
  }), /duplicate proxy response header prefix/);
});

test("proxy rejects restricted upstream request headers", () => {
  assert.throws(() => createOpenAIProxy({
    gate: fixtureGate(),
    upstreamBaseUrl: "https://upstream.example/v1",
    upstreamRequestHeaders: { authorization: "Bearer static" },
  }), /restricted proxy request header/);
});
