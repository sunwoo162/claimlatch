import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_PROVIDER_PROFILE_NAMES,
  formatProxyProviderProfileNames,
  resolveProxyProviderProfile,
} from "../src/proxy-profiles.js";

test("proxy profile names are centralized for CLI and SDK consumers", () => {
  assert.deepEqual(PROXY_PROVIDER_PROFILE_NAMES, [
    "azure",
    "cohere",
    "deepseek",
    "fireworks",
    "groq",
    "mistral",
    "openrouter",
    "together",
    "xai",
  ]);
  assert.equal(
    formatProxyProviderProfileNames(),
    "azure, cohere, deepseek, fireworks, groq, mistral, openrouter, together, or xai",
  );
});

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

test("proxy profiles provide Mistral-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("mistral"), {
    upstreamBaseUrl: "https://api.mistral.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide Cohere-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("cohere"), {
    upstreamBaseUrl: "https://api.cohere.ai/compatibility/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide DeepSeek-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("deepseek"), {
    upstreamBaseUrl: "https://api.deepseek.com",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide Fireworks-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("fireworks"), {
    upstreamBaseUrl: "https://api.fireworks.ai/inference/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide Together-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("together"), {
    upstreamBaseUrl: "https://api.together.xyz/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide xAI-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("xai"), {
    upstreamBaseUrl: "https://api.x.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles fail closed for unknown names and incomplete OpenRouter metadata", () => {
  assert.throws(() => resolveProxyProviderProfile("unknown"), /Unsupported proxy provider profile/);
  assert.throws(() => resolveProxyProviderProfile("openrouter"), /siteUrl and appName/);
});
