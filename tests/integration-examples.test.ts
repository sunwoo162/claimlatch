import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST, runtime } from "../examples/next-route-handler.js";
import { renderReceiptStorageOutput } from "../examples/receipt-storage.js";

test("Next.js route example exports Fetch-native GET and POST handlers", () => {
  assert.equal(typeof GET, "function");
  assert.equal(typeof POST, "function");
  assert.equal(runtime, "nodejs");
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
