import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProxyHeaderMap,
  renderProxyHelp,
  resolveProxyProviderConfiguration,
} from "../src/proxy-cli-options.js";

test("proxy CLI help documents credentials, routes, and fail-closed behavior", () => {
  const help = renderProxyHelp();

  assert.match(help, /Usage:\s+claimlatch-proxy/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/);
  assert.match(help, /CLAIMLATCH_LLM_MODEL/);
  assert.match(help, /TAVILY_API_KEY/);
  assert.match(help, /POST \/v1\/chat\/completions/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS/);
  assert.match(help, /CLAIMLATCH_PROXY_PROVIDER_PROFILE/);
  assert.match(help, /azure, groq, mistral, or openrouter/);
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
    upstreamRequestHeaders: {
      "HTTP-Referer": "https://claimlatch.example",
      "X-Title": "ClaimLatch",
      "x-tenant": "prod",
      "x-signature": "a=b",
    },
  });
});
