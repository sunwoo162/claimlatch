import { createDefaultClaimLatch, createOpenAIProxy } from "../src/index.js";

async function main(): Promise<void> {
  const upstreamBaseUrl = process.env.CLAIMLATCH_PROXY_UPSTREAM_BASE_URL;
  const upstreamApiKey = process.env.CLAIMLATCH_PROXY_UPSTREAM_API_KEY;
  const upstreamChatCompletionsPath = process.env.CLAIMLATCH_PROXY_UPSTREAM_CHAT_COMPLETIONS_PATH
    ?? "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21";
  const llmModel = process.env.CLAIMLATCH_LLM_MODEL;
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  const host = process.env.CLAIMLATCH_PROXY_HOST ?? "127.0.0.1";
  const port = parsePort(process.env.CLAIMLATCH_PROXY_PORT ?? "4317");

  if (!upstreamBaseUrl) {
    throw new Error("Set CLAIMLATCH_PROXY_UPSTREAM_BASE_URL to the provider base URL.");
  }
  if (!llmModel) throw new Error("Set CLAIMLATCH_LLM_MODEL for the verifier model.");
  if (!tavilyApiKey) throw new Error("Set TAVILY_API_KEY for evidence retrieval.");

  const gate = createDefaultClaimLatch({
    llmModel,
    tavilyApiKey,
    ...(process.env.CLAIMLATCH_LLM_API_KEY
      ? { llmApiKey: process.env.CLAIMLATCH_LLM_API_KEY }
      : {}),
    ...(process.env.CLAIMLATCH_LLM_BASE_URL
      ? { llmBaseUrl: process.env.CLAIMLATCH_LLM_BASE_URL }
      : {}),
  });

  const proxy = createOpenAIProxy({
    gate,
    upstreamBaseUrl,
    upstreamChatCompletionsPath,
    upstreamApiKeyHeader: process.env.CLAIMLATCH_PROXY_UPSTREAM_API_KEY_HEADER ?? "api-key",
    ...(upstreamApiKey ? { upstreamApiKey } : {}),
    ...(process.env.CLAIMLATCH_PROXY_UPSTREAM_TIMEOUT_MS
      ? { upstreamTimeoutMs: parseTimeout(process.env.CLAIMLATCH_PROXY_UPSTREAM_TIMEOUT_MS) }
      : {}),
  });

  await proxy.listen(port, host);
  process.stdout.write(
    `Provider-compatible ClaimLatch proxy listening on http://${host}:${port}/v1\n`,
  );
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("CLAIMLATCH_PROXY_PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

function parseTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("CLAIMLATCH_PROXY_UPSTREAM_TIMEOUT_MS must be a finite non-negative number.");
  }
  return parsed;
}

main().catch((error: unknown) => {
  process.stderr.write(`provider-compatible-proxy: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
