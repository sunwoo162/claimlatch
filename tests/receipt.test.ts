import assert from "node:assert/strict";
import test from "node:test";
import {
  createSignedVerificationReceipt,
  verifySignedVerificationReceipt,
} from "../src/receipt.js";
import type { VerificationReport } from "../src/types.js";

const privateKeyPem = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIA5o+kxfZLkCkVmfck+DWeQHUPJMmhrVvy3bMY5B4yce
-----END PRIVATE KEY-----
`;

const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWSzOdmFYovKtzfdtxzINGW47WXaWju7Jsp08Avj7Gyo=
-----END PUBLIC KEY-----
`;

const report: VerificationReport = {
  passed: true,
  coverage: 1,
  counts: { total: 1, supported: 1, contradicted: 0, unsupported: 0, unverifiable: 0 },
  claims: [],
  violations: [],
  generatedAt: "2026-09-29T00:00:00.000Z",
};

test("signed verification receipts are deterministic and verifiable", () => {
  const first = createSignedVerificationReceipt(report, { privateKeyPem, publicKeyPem, keyId: "fixture-key" });
  const second = createSignedVerificationReceipt(report, { privateKeyPem, publicKeyPem, keyId: "fixture-key" });

  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.algorithm, "Ed25519");
  assert.equal(first.payload.keyId, "fixture-key");
  assert.equal(verifySignedVerificationReceipt(first), true);
});

test("receipt verification fails when the report is tampered with", () => {
  const receipt = createSignedVerificationReceipt(report, { privateKeyPem, publicKeyPem });
  const tampered = {
    ...receipt,
    payload: {
      ...receipt.payload,
      report: { ...receipt.payload.report, passed: false },
    },
  };

  assert.equal(verifySignedVerificationReceipt(tampered), false);
});

test("receipt verification fails for a different public key or invalid signature", () => {
  const receipt = createSignedVerificationReceipt(report, { privateKeyPem, publicKeyPem });
  const otherKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMAv2OQLdt6DNpnq/zf54mdeV98ZScwOYfIDXKRLU6/0=
-----END PUBLIC KEY-----
`;

  assert.equal(verifySignedVerificationReceipt(receipt, { publicKeyPem: otherKey }), false);
  assert.equal(verifySignedVerificationReceipt({ ...receipt, signature: "invalid" }), false);
});
