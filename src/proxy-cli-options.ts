import { resolveProxyProviderProfile } from "./proxy-profiles.js";

export interface ProxyProviderConfiguration {
  upstreamBaseUrl: string;
  upstreamApiKeyHeader: string;
  upstreamChatCompletionsPath: string;
  upstreamRequestHeaders?: Record<string, string>;
}

export function parseProxyHeaderMap(value: string, variableName = "CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS"): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of value.split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new Error(`${variableName} must contain comma-separated name=value entries.`);
    }
    const name = entry.slice(0, separator).trim();
    const headerValue = entry.slice(separator + 1).trim();
    if (!name) throw new Error(`${variableName} must contain non-empty header names.`);
    headers[name] = headerValue;
  }
  return headers;
}

export function resolveProxyProviderConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): ProxyProviderConfiguration {
  const profile = resolveProxyProviderProfile(env.CLAIMLATCH_PROXY_PROVIDER_PROFILE, {
    ...(env.CLAIMLATCH_PROXY_OPENROUTER_SITE_URL
      ? { siteUrl: env.CLAIMLATCH_PROXY_OPENROUTER_SITE_URL }
      : {}),
    ...(env.CLAIMLATCH_PROXY_OPENROUTER_APP_NAME
      ? { appName: env.CLAIMLATCH_PROXY_OPENROUTER_APP_NAME }
      : {}),
  });
  const upstreamBaseUrl = env.CLAIMLATCH_PROXY_UPSTREAM_BASE_URL ?? profile.upstreamBaseUrl;
  if (!upstreamBaseUrl) {
    throw new Error("Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL to the generation provider base URL.");
  }
  const upstreamRequestHeaders = {
    ...profile.upstreamRequestHeaders,
    ...(env.CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS !== undefined
      ? parseProxyHeaderMap(env.CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS)
      : {}),
  };
  return {
    upstreamBaseUrl,
    upstreamApiKeyHeader: env.CLAIMLATCH_PROXY_UPSTREAM_API_KEY_HEADER ?? profile.upstreamApiKeyHeader,
    upstreamChatCompletionsPath:
      env.CLAIMLATCH_PROXY_UPSTREAM_CHAT_COMPLETIONS_PATH ?? profile.upstreamChatCompletionsPath,
    ...(Object.keys(upstreamRequestHeaders).length > 0 ? { upstreamRequestHeaders } : {}),
  };
}

export function renderProxyHelp(): string {
  return [
    "ClaimLatch OpenAI-compatible verification proxy",
    "",
    "Usage:",
    "  claimlatch-proxy",
    "",
    "Required environment variables:",
    "  CLAIMLATCH_PROXY_UPSTREAM_BASE_URL  Generation provider base URL",
    "  CLAIMLATCH_LLM_MODEL                 Verification model",
    "  TAVILY_API_KEY                       Evidence search credential",
    "",
    "Optional environment variables:",
    "  CLAIMLATCH_PROXY_UPSTREAM_API_KEY   Upstream provider credential",
    "  CLAIMLATCH_PROXY_PROVIDER_PROFILE   Example profile: azure, cohere, groq, mistral, or openrouter",
    "  CLAIMLATCH_PROXY_OPENROUTER_SITE_URL / _APP_NAME",
    "  CLAIMLATCH_LLM_API_KEY               Verification model credential",
    "  CLAIMLATCH_PROXY_HOST / _PORT        Bind host and port (127.0.0.1 / 4317)",
    "  CLAIMLATCH_PROXY_UPSTREAM_API_KEY_HEADER",
    "  CLAIMLATCH_PROXY_UPSTREAM_CHAT_COMPLETIONS_PATH",
    "  CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS   Comma-separated name=value headers",
    "  CLAIMLATCH_PROXY_UPSTREAM_RESPONSE_HEADER_NAMES",
    "  CLAIMLATCH_PROXY_UPSTREAM_RESPONSE_HEADER_PREFIXES",
    "  CLAIMLATCH_PROXY_UPSTREAM_TIMEOUT_MS",
    "  CLAIMLATCH_REQUIRE_DOCUMENT_PROVENANCE",
    "",
    "Routes:",
    "  GET  /health",
    "  POST /v1/chat/completions",
    "  POST /chat/completions",
    "",
    "PASS releases the verified completion. BLOCK returns HTTP 422.",
    "Malformed, unsupported, truncated, or unverifiable responses fail closed.",
    "This credential-free claimlatch-proxy --help command displays this help without credentials.",
    "",
  ].join("\n");
}
