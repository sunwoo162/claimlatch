import assert from "node:assert/strict";
import test from "node:test";
import { parseReceiptCliArguments, renderReceiptHelp } from "../src/receipt-cli-options.js";
import { renderReceiptVerificationJson } from "../src/receipt-cli-output.js";

test("receipt CLI help documents verification command and fail-closed exit codes", () => {
  const help = renderReceiptHelp();

  assert.match(help, /Usage:\s+claimlatch-receipt verify/);
  assert.match(help, /--file <path>/);
  assert.match(help, /--public-key-file <path>/);
  assert.match(help, /--json/);
  assert.match(help, /0\s+Receipt signature is valid/);
  assert.match(help, /1\s+Receipt is invalid/);
  assert.match(help, /2\s+Usage or file error/);
});

test("receipt CLI argument parser rejects unknown options", () => {
  assert.throws(
    () => parseReceiptCliArguments(["verify", "--file", "receipt.json", "--unexpected"]),
    /Unknown option: --unexpected/,
  );
});

test("receipt CLI JSON output exposes signed receipt metadata for audit logs", () => {
  const output = renderReceiptVerificationJson({
    valid: true,
    filePath: "receipts/answer-001.json",
    publicKeyPath: "keys/current.pem",
    receipt: {
      version: 1,
      algorithm: "Ed25519",
      payload: {
        keyId: "key-2026-09",
      },
    },
  });

  assert.deepEqual(JSON.parse(output), {
    valid: true,
    file: "receipts/answer-001.json",
    version: 1,
    algorithm: "Ed25519",
    keyId: "key-2026-09",
    publicKeyFile: "keys/current.pem",
  });
});

test("receipt CLI JSON output omits untrusted metadata with an invalid receipt shape", () => {
  const output = renderReceiptVerificationJson({
    valid: false,
    filePath: "receipts/invalid.json",
    receipt: { version: 2, algorithm: "unknown", payload: { keyId: 123 } },
  });

  assert.deepEqual(JSON.parse(output), {
    valid: false,
    file: "receipts/invalid.json",
  });
});
