import assert from "node:assert/strict";
import test from "node:test";
import { ClaimLatch } from "../src/gate.js";
import { ClaimLatchBlockedError, verifyBeforeRelease } from "../src/integrations.js";
import type { ClaimExtractor, ClaimVerifier, EvidenceProvider } from "../src/types.js";

function fixtureGate(): ClaimLatch {
  const extractor: ClaimExtractor = {
    async extract({ answer }) {
      return [{ id: "claim_1", text: answer, kind: "fact", importance: "critical" }];
    },
  };
  const evidenceProvider: EvidenceProvider = {
    async search(claim) {
      return [{
        id: "e1",
        claimId: claim.id,
        title: "fixture",
        url: "https://example.test/source",
        snippet: claim.text,
        sourceType: "primary",
        retrievedAt: "2026-09-29T00:00:00.000Z",
        provider: "fixture",
      }];
    },
  };
  const verifier: ClaimVerifier = {
    async verify({ claim, evidence }) {
      const status = claim.text.includes("blocked") ? "CONTRADICTED" as const : "SUPPORTED" as const;
      return { claim, status, reason: "fixture", evidenceIds: ["e1"], evidence };
    },
  };
  return new ClaimLatch({ extractor, evidenceProvider, verifier });
}

test("verifyBeforeRelease returns the draft only after PASS", async () => {
  const result = await verifyBeforeRelease(fixtureGate(), {
    question: "question",
    answer: "supported draft",
  });

  assert.equal(result.answer, "supported draft");
  assert.equal(result.report.passed, true);
});

test("verifyBeforeRelease throws a report-bearing error on BLOCK", async () => {
  let caught: unknown;
  try {
    await verifyBeforeRelease(fixtureGate(), {
      question: "question",
      answer: "blocked draft",
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ClaimLatchBlockedError);
  assert.equal((caught as ClaimLatchBlockedError).report.passed, false);
  assert.equal((caught as ClaimLatchBlockedError).report.violations[0]?.code, "CONTRADICTION");
});
