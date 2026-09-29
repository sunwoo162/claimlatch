export type ProxyProviderProfileName = "azure" | "groq" | "openrouter";

export interface ProxyProviderProfileOptions {
  siteUrl?: string;
  appName?: string;
}

export interface ProxyProviderProfile {
  upstreamBaseUrl?: string;
  upstreamApiKeyHeader: string;
  upstreamChatCompletionsPath: string;
  upstreamRequestHeaders?: Record<string, string>;
}

export function resolveProxyProviderProfile(
  name: string | undefined,
  options: ProxyProviderProfileOptions = {},
): ProxyProviderProfile {
  const profile = name ?? "azure";
  if (profile === "azure") {
    return {
      upstreamApiKeyHeader: "api-key",
      upstreamChatCompletionsPath: "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
    };
  }
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
  if (profile === "groq") {
    return {
      upstreamBaseUrl: "https://api.groq.com/openai/v1",
      upstreamApiKeyHeader: "authorization",
      upstreamChatCompletionsPath: "/chat/completions",
    };
  }
  throw new Error(`Unsupported proxy provider profile: ${profile}. Use azure, groq, or openrouter.`);
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
}
