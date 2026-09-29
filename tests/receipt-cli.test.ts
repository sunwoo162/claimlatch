import assert from "node:assert/strict";
import test from "node:test";
import { parseReceiptCliArguments, renderReceiptHelp } from "../src/receipt-cli-options.js";

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
