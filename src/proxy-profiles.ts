export const PROXY_PROVIDER_PROFILE_NAMES = [
  "ai21",
  "aimlapi",
  "aphrodite",
  "azure",
  "baichuan",
  "baseten",
  "cerebras",
  "cerebrium",
  "chutes",
  "clarifai",
  "cloudflare",
  "cohere",
  "dashscope",
  "deepinfra",
  "deepseek",
  "featherless",
  "fastchat",
  "fireworks",
  "friendli",
  "gemini",
  "groq",
  "huggingface",
  "hyperbolic",
  "inferencenet",
  "ionos",
  "jan",
  "koboldcpp",
  "lamini",
  "litellm",
  "llamacpp",
  "lmdeploy",
  "lmstudio",
  "localai",
  "mlx",
  "hunyuan",
  "minimax",
  "mimo",
  "mistral",
  "modal",
  "moonshot",
  "nebius",
  "nscale",
  "novita",
  "nvidia",
  "ollama",
  "openllm",
  "openai",
  "openrouter",
  "ovhcloud",
  "perplexity",
  "poe",
  "qianfan",
  "requesty",
  "sambanova",
  "scaleway",
  "sglang",
  "siliconflow",
  "stepfun",
  "tgi",
  "tensorrtllm",
  "together",
  "tokenhub",
  "upstage",
  "vllm",
  "volcengine",
  "xinference",
  "xai",
  "zai",
] as const;

export type ProxyProviderProfileName = (typeof PROXY_PROVIDER_PROFILE_NAMES)[number];

export function formatProxyProviderProfileNames(): string {
  const last = PROXY_PROVIDER_PROFILE_NAMES[PROXY_PROVIDER_PROFILE_NAMES.length - 1];
  return `${PROXY_PROVIDER_PROFILE_NAMES.slice(0, -1).join(", ")}, or ${last}`;
}

export interface ProxyProviderProfileOptions {
  siteUrl?: string;
  appName?: string;
}

export interface ProxyProviderProfile {
  upstreamBaseUrl?: string;
  upstreamApiKeyHeader: string;
  upstreamApiKeyPrefix?: string;
  upstreamChatCompletionsPath: string;
  upstreamModelsPath?: string | null;
  upstreamModelRetrievalPath?: string | null;
  upstreamRequestHeaders?: Record<string, string>;
}

type StaticProxyProviderProfileName = Exclude<ProxyProviderProfileName, "openrouter">;

const STATIC_PROXY_PROVIDER_PROFILES: Readonly<Record<StaticProxyProviderProfileName, ProxyProviderProfile>> = {
  ai21: {
    upstreamBaseUrl: "https://api.ai21.com/studio/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  aimlapi: {
    upstreamBaseUrl: "https://api.aimlapi.com",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/models",
  },
  aphrodite: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
    upstreamModelRetrievalPath: null,
  },
  azure: {
    upstreamApiKeyHeader: "api-key",
    upstreamChatCompletionsPath: "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
    upstreamModelsPath: "/openai/models?api-version=2024-10-21",
  },
  baichuan: {
    upstreamBaseUrl: "https://api.baichuan-ai.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: null,
  },
  baseten: {
    upstreamBaseUrl: "https://inference.baseten.co/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  cerebras: {
    upstreamBaseUrl: "https://api.cerebras.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  cerebrium: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: null,
  },
  chutes: {
    upstreamBaseUrl: "https://llm.chutes.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  clarifai: {
    upstreamBaseUrl: "https://api.clarifai.com/v2/ext/openai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamApiKeyPrefix: "Key",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: null,
  },
  cloudflare: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: null,
  },
  cohere: {
    upstreamBaseUrl: "https://api.cohere.ai/compatibility/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  dashscope: {
    upstreamBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  deepinfra: {
    upstreamBaseUrl: "https://api.deepinfra.com/v1/openai",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  deepseek: {
    upstreamBaseUrl: "https://api.deepseek.com",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  featherless: {
    upstreamBaseUrl: "https://api.featherless.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  fastchat: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
    upstreamModelRetrievalPath: null,
  },
  fireworks: {
    upstreamBaseUrl: "https://api.fireworks.ai/inference/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  friendli: {
    upstreamBaseUrl: "https://api.friendli.ai/serverless/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  gemini: {
    upstreamBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  groq: {
    upstreamBaseUrl: "https://api.groq.com/openai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  huggingface: {
    upstreamBaseUrl: "https://router.huggingface.co/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  hyperbolic: {
    upstreamBaseUrl: "https://api.hyperbolic.xyz/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  inferencenet: {
    upstreamBaseUrl: "https://api.inference.net/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  ionos: {
    upstreamBaseUrl: "https://openai.inference.de-txl.ionos.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  jan: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  koboldcpp: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
    upstreamModelRetrievalPath: null,
  },
  lamini: {
    upstreamBaseUrl: "https://api.lamini.ai/inf",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  litellm: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  llamacpp: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  lmdeploy: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
    upstreamModelRetrievalPath: null,
  },
  lmstudio: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  localai: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  mlx: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  hunyuan: {
    upstreamBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  minimax: {
    upstreamBaseUrl: "https://api.minimax.io/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  mimo: {
    upstreamBaseUrl: "https://api.xiaomimimo.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  mistral: {
    upstreamBaseUrl: "https://api.mistral.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  modal: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: null,
  },
  moonshot: {
    upstreamBaseUrl: "https://api.moonshot.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  nebius: {
    upstreamBaseUrl: "https://api.tokenfactory.nebius.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  nscale: {
    upstreamBaseUrl: "https://inference.api.nscale.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  novita: {
    upstreamBaseUrl: "https://api.novita.ai/openai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  nvidia: {
    upstreamBaseUrl: "https://integrate.api.nvidia.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  ollama: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  openllm: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
    upstreamModelRetrievalPath: null,
  },
  openai: {
    upstreamBaseUrl: "https://api.openai.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  ovhcloud: {
    upstreamBaseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: null,
  },
  perplexity: {
    upstreamBaseUrl: "https://api.perplexity.ai/router/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  poe: {
    upstreamBaseUrl: "https://api.poe.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  qianfan: {
    upstreamBaseUrl: "https://qianfan.baidubce.com/v2",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  requesty: {
    upstreamBaseUrl: "https://router.requesty.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  sambanova: {
    upstreamBaseUrl: "https://api.sambanova.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  scaleway: {
    upstreamBaseUrl: "https://api.scaleway.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  sglang: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  tgi: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: null,
  },
  tensorrtllm: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
    upstreamModelRetrievalPath: null,
  },
  siliconflow: {
    upstreamBaseUrl: "https://api.siliconflow.cn/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  stepfun: {
    upstreamBaseUrl: "https://api.stepfun.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  together: {
    upstreamBaseUrl: "https://api.together.xyz/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  tokenhub: {
    upstreamBaseUrl: "https://tokenhub.tencentmaas.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  upstage: {
    upstreamBaseUrl: "https://api.upstage.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  vllm: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
  },
  volcengine: {
    upstreamBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  xinference: {
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/v1/chat/completions",
    upstreamModelsPath: "/v1/models",
    upstreamModelRetrievalPath: null,
  },
  xai: {
    upstreamBaseUrl: "https://api.x.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  zai: {
    upstreamBaseUrl: "https://api.z.ai/api/paas/v4",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
};

export function resolveProxyProviderProfile(
  name: string | undefined,
  options: ProxyProviderProfileOptions = {},
): ProxyProviderProfile {
  const profile = name ?? "azure";
  if (profile === "openrouter") {
    const siteUrl = requireNonEmpty(options.siteUrl, "siteUrl");
    const appName = requireNonEmpty(options.appName, "appName");
    validateHttpUrl(siteUrl, "siteUrl");
    return {
      upstreamBaseUrl: "https://openrouter.ai/api/v1",
      upstreamApiKeyHeader: "authorization",
      upstreamChatCompletionsPath: "/chat/completions",
      upstreamRequestHeaders: {
        "HTTP-Referer": siteUrl,
        "X-Title": appName,
      },
    };
  }
  const staticProfile = STATIC_PROXY_PROVIDER_PROFILES[profile as StaticProxyProviderProfileName];
  if (staticProfile) {
    return { ...staticProfile };
  }
  throw new Error(
    `Unsupported proxy provider profile: ${profile}. Use ${formatProxyProviderProfileNames()}.`,
  );
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (!value || !value.trim()) {
    throw new Error(`OpenRouter profile requires siteUrl and appName; missing ${name}.`);
  }
  return value.trim();
}

function validateHttpUrl(value: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
}
