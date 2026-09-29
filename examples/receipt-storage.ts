import { generateKeyPairSync } from "node:crypto";
import {
  createSignedVerificationReceipt,
  FileVerificationReceiptStore,
  verifySignedVerificationReceipt,
} from "../src/index.js";
import type { VerificationReport } from "../src/types.js";

const receiptId = process.env.CLAIMLATCH_RECEIPT_ID ?? "demo-receipt";
const receiptDirectory = process.env.CLAIMLATCH_RECEIPT_DIR ?? "./var/claimlatch-receipts";

const report: VerificationReport = {
  passed: true,
  coverage: 1,
  counts: {
    total: 1,
    supported: 1,
    contradicted: 0,
    unsupported: 0,
    unverifiable: 0,
  },
  claims: [{
    claim: {
      id: "claim_demo",
      text: "ClaimLatch can persist a signed verification receipt.",
      kind: "fact",
      importance: "critical",
    },
    status: "SUPPORTED",
    reason: "The fixture evidence supports the demonstration claim.",
    evidenceIds: ["evidence_demo"],
    evidence: [{
      id: "evidence_demo",
      claimId: "claim_demo",
      title: "ClaimLatch receipt example",
      url: "https://example.test/claimlatch-receipts",
      snippet: "ClaimLatch can persist a signed verification receipt.",
      sourceType: "primary",
      retrievedAt: "2026-09-29T00:00:00.000Z",
      provider: "example",
    }],
  }],
  violations: [],
  generatedAt: "2026-09-29T00:00:00.000Z",
};

async function main(): Promise<void> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const publicKeys = new Map([["demo-key", publicKeyPem]]);
  const receipt = createSignedVerificationReceipt(report, {
    privateKeyPem,
    publicKeyPem,
    keyId: "demo-key",
  });

  const store = new FileVerificationReceiptStore({ directory: receiptDirectory });
  await store.save(receiptId, receipt);

  const stored = await store.load(receiptId);
  const verified = stored !== undefined && verifySignedVerificationReceipt(stored, {
    keyResolver: (keyId) => keyId === undefined ? undefined : publicKeys.get(keyId),
  });

  process.stdout.write(`${JSON.stringify({ receiptId, receiptDirectory, verified }, null, 2)}\n`);
  if (!verified) throw new Error("Stored receipt did not verify.");
}

main().catch((error: unknown) => {
  process.stderr.write(`receipt-storage: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
