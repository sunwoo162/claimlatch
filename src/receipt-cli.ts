#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { renderReceiptHelp } from "./receipt-cli-options.js";
import { verifySignedVerificationReceipt } from "./receipt.js";
import type { SignedVerificationReceipt } from "./types.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(renderReceiptHelp());
    return;
  }

  if (argv[0] !== "verify") throw new Error("Use `claimlatch-receipt verify --file <path>`.");
  const filePath = argumentValue(argv, "--file");
  const json = argv.includes("--json");
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as SignedVerificationReceipt;
  const valid = verifySignedVerificationReceipt(parsed);
  if (json) {
    process.stdout.write(`${JSON.stringify({ valid, file: filePath })}\n`);
  } else {
    process.stdout.write(`Receipt ${valid ? "valid" : "invalid"}: ${filePath}\n`);
  }
  process.exitCode = valid ? 0 : 1;
}

function argumentValue(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = argv[index + 1];
  if (index === -1 || !value || value.startsWith("-")) throw new Error(`${name} requires a value.`);
  return value;
}

main().catch((error: unknown) => {
  process.stderr.write(`claimlatch-receipt: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
