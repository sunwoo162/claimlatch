export const PROXY_PROVIDER_PROFILE_NAMES = [
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
  "qianfan",
  "sambanova",
  "siliconflow",
  "together",
  "xai",
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
  upstreamChatCompletionsPath: string;
  upstreamModelsPath?: string;
  upstreamRequestHeaders?: Record<string, string>;
}

type StaticProxyProviderProfileName = Exclude<ProxyProviderProfileName, "openrouter">;

const STATIC_PROXY_PROVIDER_PROFILES: Readonly<Record<StaticProxyProviderProfileName, ProxyProviderProfile>> = {
  azure: {
    upstreamApiKeyHeader: "api-key",
    upstreamChatCompletionsPath: "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
    upstreamModelsPath: "/openai/models?api-version=2024-10-21",
  },
  cerebras: {
    upstreamBaseUrl: "https://api.cerebras.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  cohere: {
    upstreamBaseUrl: "https://api.cohere.ai/compatibility/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
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
  mistral: {
    upstreamBaseUrl: "https://api.mistral.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
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
  nvidia: {
    upstreamBaseUrl: "https://integrate.api.nvidia.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  openai: {
    upstreamBaseUrl: "https://api.openai.com/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  perplexity: {
    upstreamBaseUrl: "https://api.perplexity.ai/router/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  qianfan: {
    upstreamBaseUrl: "https://qianfan.baidubce.com/v2",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
    upstreamModelsPath: "/models",
  },
  sambanova: {
    upstreamBaseUrl: "https://api.sambanova.ai/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  siliconflow: {
    upstreamBaseUrl: "https://api.siliconflow.cn/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  together: {
    upstreamBaseUrl: "https://api.together.xyz/v1",
    upstreamApiKeyHeader: "authorization",
    upstreamChatCompletionsPath: "/chat/completions",
  },
  xai: {
    upstreamBaseUrl: "https://api.x.ai/v1",
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
