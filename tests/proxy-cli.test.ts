import assert from "node:assert/strict";
import test from "node:test";
import {
  isProviderCompatibleProxyMainModule,
  resolveProviderCompatibleProxyConfiguration,
} from "../examples/provider-compatible-proxy.js";
import {
  parseProxyHeaderList,
  parseProxyHeaderMap,
  renderProxyHelp,
  resolveProxyProviderConfiguration,
} from "../src/proxy-cli-options.js";

test("proxy CLI help documents credentials, routes, and fail-closed behavior", () => {
  const help = renderProxyHelp();

  assert.match(help, /Usage:\s+claimlatch-proxy/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_BASE_URL.*required unless profile supplies one/);
  assert.match(help, /CLAIMLATCH_LLM_MODEL/);
  assert.match(help, /TAVILY_API_KEY/);
  assert.match(help, /POST \/v1\/chat\/completions/);
  assert.match(help, /GET  \/v1\/models, \/models, \/v1\/models\/:id, \/models\/:id/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_API_KEY_PREFIX.*default Bearer/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_MODELS_PATH.*profile supplies one/);
  assert.match(help, /CLAIMLATCH_PROXY_PROVIDER_PROFILE/);
  assert.match(help, /ai21, aimlapi, azure, baichuan, baseten, cerebras, cerebrium, chutes, clarifai, cloudflare, cohere, dashscope, deepinfra, deepseek, featherless, fireworks, friendli, gemini, groq, huggingface, hyperbolic, inferencenet, ionos, jan, lamini, litellm, llamacpp, lmstudio, localai, hunyuan, minimax, mimo, mistral, modal, moonshot, nebius, nscale, novita, nvidia, ollama, openai, openrouter, ovhcloud, perplexity, poe, qianfan, requesty, sambanova, scaleway, sglang, siliconflow, stepfun, together, tokenhub, upstage, vllm, volcengine, xai, or zai/);
  assert.match(help, /PASS.*BLOCK/s);
  assert.match(help, /credential-free/);
});

test("proxy header map parser preserves equals signs in values", () => {
  assert.deepEqual(parseProxyHeaderMap("x-tenant=prod,x-signature=a=b=c"), {
    "x-tenant": "prod",
    "x-signature": "a=b=c",
  });
});

test("proxy header map parser rejects entries without a name=value separator", () => {
  assert.throws(
    () => parseProxyHeaderMap("x-tenant=prod,invalid-entry"),
    /name=value entries/,
  );
});

test("proxy header map parser rejects duplicate header names case-insensitively", () => {
  assert.throws(
    () => parseProxyHeaderMap("x-tenant=prod,X-Tenant=staging"),
    /duplicate header name/,
  );
});

test("proxy response header list parser preserves trimmed entries", () => {
  assert.deepEqual(
    parseProxyHeaderList(" x-vendor-request-id, x-vendor-rate- ", "NAMES"),
    ["x-vendor-request-id", "x-vendor-rate-"],
  );
});

test("proxy response header list parser rejects duplicate names case-insensitively", () => {
  assert.throws(
    () => parseProxyHeaderList("x-vendor-request-id,X-Vendor-Request-Id", "NAMES"),
    /NAMES contains a duplicate header entry/,
  );
});

test("proxy response header list parser rejects duplicate prefixes case-insensitively", () => {
  assert.throws(
    () => parseProxyHeaderList("x-vendor-rate-,X-Vendor-Rate-", "PREFIXES"),
    /PREFIXES contains a duplicate header entry/,
  );
});

test("proxy CLI resolves provider profile defaults and explicit overrides", () => {
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "openrouter",
    CLAIMLATCH_PROXY_OPENROUTER_SITE_URL: "https://claimlatch.example",
    CLAIMLATCH_PROXY_OPENROUTER_APP_NAME: "ClaimLatch",
    CLAIMLATCH_PROXY_UPSTREAM_API_KEY_HEADER: "x-api-key",
    CLAIMLATCH_PROXY_UPSTREAM_CHAT_COMPLETIONS_PATH: "/v1/chat/completions?profile=custom",
    CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS: "x-tenant=prod,x-signature=a=b",
  }), {
    upstreamBaseUrl: "https://openrouter.ai/api/v1",
    upstreamApiKeyHeader: "x-api-key",
    upstreamChatCompletionsPath: "/v1/chat/completions?profile=custom",
    upstreamModelsPath: "/models",
    upstreamRequestHeaders: {
      "HTTP-Referer": "https://claimlatch.example",
      "X-Title": "ClaimLatch",
      "x-tenant": "prod",
      "x-signature": "a=b",
    },
  });
});

test("proxy CLI resolves an explicit upstream API key prefix", () => {
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "openai",
    CLAIMLATCH_PROXY_UPSTREAM_API_KEY_PREFIX: "Api-Key",
  }), {
    upstreamBaseUrl: "https://api.openai.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamApiKeyPrefix: "Api-Key",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  });
});

test("proxy CLI resolves Azure deployment paths with an explicit base URL", () => {
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "azure",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "https://claimlatch-resource.openai.azure.com",
  }), {
    upstreamBaseUrl: "https://claimlatch-resource.openai.azure.com",
    upstreamApiKeyHeader: "api-key",
    upstreamChatCompletionsPath: "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
    upstreamModelsPath: "/openai/models?api-version=2024-10-21",
  });
});

test("proxy CLI resolves every hosted built-in profile without an explicit base URL", () => {
  const expected = {
    ai21: "https://api.ai21.com/studio/v1",
    aimlapi: "https://api.aimlapi.com",
    baichuan: "https://api.baichuan-ai.com/v1",
    baseten: "https://inference.baseten.co/v1",
    cerebras: "https://api.cerebras.ai/v1",
    chutes: "https://llm.chutes.ai/v1",
    clarifai: "https://api.clarifai.com/v2/ext/openai/v1",
    cohere: "https://api.cohere.ai/compatibility/v1",
    dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    deepinfra: "https://api.deepinfra.com/v1/openai",
    deepseek: "https://api.deepseek.com",
    featherless: "https://api.featherless.ai/v1",
    fireworks: "https://api.fireworks.ai/inference/v1",
    friendli: "https://api.friendli.ai/serverless/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    groq: "https://api.groq.com/openai/v1",
    huggingface: "https://router.huggingface.co/v1",
    hyperbolic: "https://api.hyperbolic.xyz/v1",
    inferencenet: "https://api.inference.net/v1",
    ionos: "https://openai.inference.de-txl.ionos.com/v1",
    lamini: "https://api.lamini.ai/inf",
    hunyuan: "https://api.hunyuan.cloud.tencent.com/v1",
    minimax: "https://api.minimax.io/v1",
    mimo: "https://api.xiaomimimo.com/v1",
    mistral: "https://api.mistral.ai/v1",
    moonshot: "https://api.moonshot.ai/v1",
    nebius: "https://api.tokenfactory.nebius.com/v1",
    nscale: "https://inference.api.nscale.com/v1",
    novita: "https://api.novita.ai/openai/v1",
    nvidia: "https://integrate.api.nvidia.com/v1",
    openai: "https://api.openai.com/v1",
    ovhcloud: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    perplexity: "https://api.perplexity.ai/router/v1",
    poe: "https://api.poe.com/v1",
    qianfan: "https://qianfan.baidubce.com/v2",
    requesty: "https://router.requesty.ai/v1",
    sambanova: "https://api.sambanova.ai/v1",
    scaleway: "https://api.scaleway.ai/v1",
    siliconflow: "https://api.siliconflow.cn/v1",
    stepfun: "https://api.stepfun.ai/v1",
    together: "https://api.together.xyz/v1",
    tokenhub: "https://tokenhub.tencentmaas.com/v1",
    upstage: "https://api.upstage.ai/v1",
    volcengine: "https://ark.cn-beijing.volces.com/api/v3",
    xai: "https://api.x.ai/v1",
    zai: "https://api.z.ai/api/paas/v4",
  } as const;

  for (const [profile, upstreamBaseUrl] of Object.entries(expected)) {
    const upstreamChatCompletionsPath = profile === "aimlapi"
      ? "/v1/chat/completions"
      : "/chat/completions";
    assert.deepEqual(resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: profile,
    }), {
      upstreamBaseUrl,
      upstreamApiKeyHeader: "authorization",
      ...(profile === "clarifai" ? { upstreamApiKeyPrefix: "Key" } : {}),
      upstreamChatCompletionsPath,
      upstreamModelsPath: profile === "baichuan" || profile === "clarifai" || profile === "ovhcloud" ? null : "/models",
    });
  }
});

test("proxy CLI requires an explicit base URL for LiteLLM", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "litellm",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "litellm",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://localhost:4000",
  }), {
    upstreamBaseUrl: "http://localhost:4000",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit base URL for Ollama", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "ollama",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "ollama",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://localhost:11434",
  }), {
    upstreamBaseUrl: "http://localhost:11434",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit base URL for llama.cpp", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "llamacpp",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "llamacpp",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://localhost:8080",
  }), {
    upstreamBaseUrl: "http://localhost:8080",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit base URL for vLLM", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "vllm",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "vllm",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://localhost:8000",
  }), {
    upstreamBaseUrl: "http://localhost:8000",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit base URL for LM Studio", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "lmstudio",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "lmstudio",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://localhost:1234",
  }), {
    upstreamBaseUrl: "http://localhost:1234",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit base URL for Jan", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "jan",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "jan",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://127.0.0.1:1337",
  }), {
    upstreamBaseUrl: "http://127.0.0.1:1337",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit base URL for LocalAI", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "localai",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "localai",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://localhost:8080",
  }), {
    upstreamBaseUrl: "http://localhost:8080",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit base URL for SGLang", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "sglang",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "sglang",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "http://localhost:30000",
  }), {
    upstreamBaseUrl: "http://localhost:30000",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  });
});

test("proxy CLI requires an explicit account-scoped base URL for Cloudflare Workers AI", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "cloudflare",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "cloudflare",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1",
  }), {
    upstreamBaseUrl: "https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: null,
  });
});

test("proxy CLI requires an explicit endpoint URL for Modal", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "modal",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "modal",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "https://modal-endpoint.example",
  }), {
    upstreamBaseUrl: "https://modal-endpoint.example",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: null,
  });
});

test("proxy CLI requires an explicit endpoint URL for Cerebrium", () => {
  assert.throws(
    () => resolveProxyProviderConfiguration({
      CLAIMLATCH_PROXY_PROVIDER_PROFILE: "cerebrium",
    }),
    /Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/,
  );
  assert.deepEqual(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "cerebrium",
    CLAIMLATCH_PROXY_UPSTREAM_BASE_URL: "https://api.cortex.cerebrium.ai/v4/project/app/run",
  }), {
    upstreamBaseUrl: "https://api.cortex.cerebrium.ai/v4/project/app/run",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: null,
  });
});

test("proxy CLI allows an explicit OVHcloud model route override", () => {
  assert.equal(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "ovhcloud",
    CLAIMLATCH_PROXY_UPSTREAM_MODELS_PATH: "/v1/models",
  }).upstreamModelsPath, "/v1/models");
});

test("proxy CLI allows an explicit Baichuan model route override", () => {
  assert.equal(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "baichuan",
    CLAIMLATCH_PROXY_UPSTREAM_MODELS_PATH: "/v1/models",
  }).upstreamModelsPath, "/v1/models");
});

test("proxy CLI allows an explicit MiMo model route override", () => {
  assert.equal(resolveProxyProviderConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "mimo",
    CLAIMLATCH_PROXY_UPSTREAM_MODELS_PATH: "/v1/models",
  }).upstreamModelsPath, "/v1/models");
});

test("provider-compatible proxy example preserves the configured model route", () => {
  const configuration = resolveProviderCompatibleProxyConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "openai",
    CLAIMLATCH_PROXY_UPSTREAM_MODELS_PATH: "/v1/custom-models",
  });

  assert.equal(configuration.upstreamModelsPath, "/v1/custom-models");
});

test("provider-compatible proxy example preserves OpenRouter attribution headers", () => {
  const configuration = resolveProviderCompatibleProxyConfiguration({
    CLAIMLATCH_PROXY_PROVIDER_PROFILE: "openrouter",
    CLAIMLATCH_PROXY_OPENROUTER_SITE_URL: "https://claimlatch.example",
    CLAIMLATCH_PROXY_OPENROUTER_APP_NAME: "ClaimLatch",
  });

  assert.deepEqual(configuration, {
    upstreamBaseUrl: "https://openrouter.ai/api/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
    upstreamRequestHeaders: {
      "HTTP-Referer": "https://claimlatch.example",
      "X-Title": "ClaimLatch",
    },
  });
});

test("provider-compatible proxy example main guard normalizes POSIX and Windows paths", () => {
  assert.equal(
    isProviderCompatibleProxyMainModule(
      "file:///home/runner/claimlatch/dist/examples/provider-compatible-proxy.js",
      "/home/runner/claimlatch/dist/examples/provider-compatible-proxy.js",
    ),
    true,
  );
  assert.equal(
    isProviderCompatibleProxyMainModule(
      "file:///C:/claimlatch/dist/examples/provider-compatible-proxy.js",
      "C:\\claimlatch\\dist\\examples\\provider-compatible-proxy.js",
    ),
    true,
  );
  assert.equal(
    isProviderCompatibleProxyMainModule(
      "file:///home/runner/claimlatch/dist/examples/provider-compatible-proxy.js",
      "/home/runner/claimlatch/dist/examples/other.js",
    ),
    false,
  );
});
