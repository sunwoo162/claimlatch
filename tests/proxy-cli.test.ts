import assert from "node:assert/strict";
import test from "node:test";
import { renderProxyHelp } from "../src/proxy-cli-options.js";

test("proxy CLI help documents credentials, routes, and fail-closed behavior", () => {
  const help = renderProxyHelp();

  assert.match(help, /Usage:\s+claimlatch-proxy/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_BASE_URL/);
  assert.match(help, /CLAIMLATCH_LLM_MODEL/);
  assert.match(help, /TAVILY_API_KEY/);
  assert.match(help, /POST \/v1\/chat\/completions/);
  assert.match(help, /CLAIMLATCH_PROXY_UPSTREAM_REQUEST_HEADERS/);
  assert.match(help, /PASS.*BLOCK/s);
  assert.match(help, /credential-free/);
});
