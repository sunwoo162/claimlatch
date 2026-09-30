import assert from "node:assert/strict";
import test from "node:test";
import cloudflareWorker from "../examples/cloudflare-worker.js";
import {
  createExpressGuardedAnswerHandler,
  type ExpressRequest,
  type ExpressResponse,
} from "../examples/express-route-handler.js";
import { GET, POST, runtime } from "../examples/next-route-handler.js";
import { action, loader } from "../examples/remix-route-handler.js";
import {
  isReceiptStorageMainModule,
  renderReceiptStorageOutput,
} from "../examples/receipt-storage.js";

test("Next.js route example exports Fetch-native GET and POST handlers", () => {
  assert.equal(typeof GET, "function");
  assert.equal(typeof POST, "function");
  assert.equal(runtime, "nodejs");
});

test("Remix route example exports Fetch-native loader and action handlers", () => {
  assert.equal(typeof loader, "function");
  assert.equal(typeof action, "function");
});

test("Cloudflare Worker example exports a Fetch-native worker", () => {
  assert.equal(typeof cloudflareWorker.fetch, "function");
});

test("Express example adapts parsed JSON requests to the guarded Fetch handler", async () => {
  let statusCode: number | undefined;
  const responseHeaders = new Map<string, string>();
  let responseBody: string | undefined;
  const handler = createExpressGuardedAnswerHandler(async (request) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "http://example.test/answer");
    assert.deepEqual(await request.json(), { question: "question", draft: "draft" });
    return new Response(JSON.stringify({ answer: "verified" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-claimlatch-result": "pass" },
    });
  });
  const request: ExpressRequest = {
    method: "POST",
    protocol: "http",
    originalUrl: "/api/answer",
    url: "/answer",
    body: { question: "question", draft: "draft" },
    get(name) {
      return name.toLowerCase() === "host" ? "example.test" : undefined;
    },
  };
  const response: ExpressResponse = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(name, value) {
      responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : value);
      return this;
    },
    send(body) {
      responseBody = body;
      return this;
    },
  };

  await handler(request, response);

  assert.equal(statusCode, 200);
  assert.equal(responseHeaders.get("content-type"), "application/json");
  assert.equal(responseHeaders.get("x-claimlatch-result"), "pass");
  assert.equal(responseBody, JSON.stringify({ answer: "verified" }));
});

test("receipt storage example renders the canonical payload hash", () => {
  const output = JSON.parse(renderReceiptStorageOutput({
    receiptId: "demo-receipt",
    receiptDirectory: "./var/claimlatch-receipts",
    verified: true,
    payloadSha256: "a".repeat(64),
  })) as { verified?: boolean; payloadSha256?: string };
  assert.equal(output.verified, true);
  assert.match(output.payloadSha256 ?? "", /^[0-9a-f]{64}$/u);
});

test("receipt storage example main guard normalizes POSIX and Windows paths", () => {
  assert.equal(
    isReceiptStorageMainModule(
      "file:///home/runner/claimlatch/dist/examples/receipt-storage.js",
      "/home/runner/claimlatch/dist/examples/receipt-storage.js",
    ),
    true,
  );
  assert.equal(
    isReceiptStorageMainModule(
      "file:///C:/claimlatch/dist/examples/receipt-storage.js",
      "C:\\claimlatch\\dist\\examples\\receipt-storage.js",
    ),
    true,
  );
  assert.equal(
    isReceiptStorageMainModule(
      "file:///home/runner/claimlatch/dist/examples/receipt-storage.js",
      "/home/runner/claimlatch/dist/examples/other.js",
    ),
    false,
  );
});
