import assert from "node:assert/strict";
import test from "node:test";
import { resolveProxyProviderProfile } from "../src/proxy-profiles.js";

test("proxy profiles provide Azure-compatible defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("azure"), {
    upstreamApiKeyHeader: "api-key",
    upstreamChatCompletionsPath: "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
  });
});

test("proxy profiles provide OpenRouter-compatible defaults and headers", () => {
  assert.deepEqual(resolveProxyProviderProfile("openrouter", {
    siteUrl: "https://claimlatch.example",
    appName: "ClaimLatch",
  }), {
    upstreamBaseUrl: "https://openrouter.ai/api/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamRequestHeaders: {
      "HTTP-Referer": "https://claimlatch.example",
      "X-Title": "ClaimLatch",
    },
  });
});

test("proxy profiles provide Groq-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("groq"), {
    upstreamBaseUrl: "https://api.groq.com/openai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles fail closed for unknown names and incomplete OpenRouter metadata", () => {
  assert.throws(() => resolveProxyProviderProfile("unknown"), /Unsupported proxy provider profile/);
  assert.throws(() => resolveProxyProviderProfile("openrouter"), /siteUrl and appName/);
});
