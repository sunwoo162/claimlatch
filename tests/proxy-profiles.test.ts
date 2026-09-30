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
  "cerebras",
    "cohere",
    "deepinfra",
    "deepseek",
    "fireworks",
    "friendli",
    "gemini",
    "groq",
    "huggingface",
    "mistral",
    "moonshot",
    "nebius",
    "nvidia",
    "openai",
    "openrouter",
    "perplexity",
    "sambanova",
    "siliconflow",
    "together",
    "xai",
  ]);
  assert.equal(
    formatProxyProviderProfileNames(),
    "azure, cerebras, cohere, deepinfra, deepseek, fireworks, friendli, gemini, groq, huggingface, mistral, moonshot, nebius, nvidia, openai, openrouter, perplexity, sambanova, siliconflow, together, or xai",
  );
});

test("proxy profiles provide Azure-compatible defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("azure"), {
    upstreamApiKeyHeader: "api-key",
    upstreamChatCompletionsPath: "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
    upstreamModelsPath: "/openai/models?api-version=2024-10-21",
  });
});

test("proxy profiles provide Cerebras-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("cerebras"), {
    upstreamBaseUrl: "https://api.cerebras.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
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

test("proxy profiles provide Gemini OpenAI-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("gemini"), {
    upstreamBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
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

test("proxy profiles provide Moonshot-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("moonshot"), {
    upstreamBaseUrl: "https://api.moonshot.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide Nebius-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("nebius"), {
    upstreamBaseUrl: "https://api.tokenfactory.nebius.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide Hugging Face Inference Providers defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("huggingface"), {
    upstreamBaseUrl: "https://router.huggingface.co/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide OpenAI-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("openai"), {
    upstreamBaseUrl: "https://api.openai.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide NVIDIA NIM-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("nvidia"), {
    upstreamBaseUrl: "https://integrate.api.nvidia.com/v1",
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

test("proxy profiles provide DeepInfra-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("deepinfra"), {
    upstreamBaseUrl: "https://api.deepinfra.com/v1/openai",
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

test("proxy profiles provide FriendliAI-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("friendli"), {
    upstreamBaseUrl: "https://api.friendli.ai/serverless/v1",
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

test("proxy profiles provide Perplexity Router-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("perplexity"), {
    upstreamBaseUrl: "https://api.perplexity.ai/router/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide SambaNova-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("sambanova"), {
    upstreamBaseUrl: "https://api.sambanova.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("proxy profiles provide SiliconFlow-compatible Chat Completions defaults", () => {
  assert.deepEqual(resolveProxyProviderProfile("siliconflow"), {
    upstreamBaseUrl: "https://api.siliconflow.cn/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  });
});

test("every hosted proxy profile resolves a complete HTTPS Chat Completions contract", () => {
  for (const profile of PROXY_PROVIDER_PROFILE_NAMES) {
    if (profile === "azure" || profile === "openrouter") continue;
    const resolved = resolveProxyProviderProfile(profile);
    assert.match(resolved.upstreamBaseUrl ?? "", /^https:\/\//);
    assert.equal(resolved.upstreamApiKeyHeader, "authorization");
    assert.equal(resolved.upstreamChatCompletionsPath, "/chat/completions");
  }
});

test("proxy profiles fail closed for unknown names and incomplete OpenRouter metadata", () => {
  assert.throws(() => resolveProxyProviderProfile("unknown"), /Unsupported proxy provider profile/);
  assert.throws(() => resolveProxyProviderProfile("openrouter"), /siteUrl and appName/);
  assert.throws(
    () => resolveProxyProviderProfile("openrouter", {
      siteUrl: "https://user:password@example.com",
      appName: "ClaimLatch",
    }),
    /absolute HTTP or HTTPS URL/,
  );
});
