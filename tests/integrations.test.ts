import assert from "node:assert/strict";
import test from "node:test";
import { ClaimLatch } from "../src/gate.js";
import {
  ClaimLatchBlockedError,
  createGuardedAnswerServer,
  verifyBeforeRelease,
} from "../src/integrations.js";
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

async function withGuardedAnswerServer(
  run: (url: string) => Promise<void>,
): Promise<void> {
  const service = createGuardedAnswerServer({ gate: fixtureGate() });
  await service.listen(0, "127.0.0.1");
  const address = service.server.address();
  if (!address || typeof address === "string") throw new Error("missing guarded answer address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await service.close();
  }
}

test("guarded answer HTTP integration releases only verified answers", async () => {
  await withGuardedAnswerServer(async (url) => {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);

    const response = await fetch(`${url}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "question", draft: "supported draft" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { answer?: string; report?: { passed?: boolean } };
    assert.equal(body.answer, "supported draft");
    assert.equal(body.report?.passed, true);
  });
});

test("guarded answer HTTP integration returns a report-bearing BLOCK", async () => {
  await withGuardedAnswerServer(async (url) => {
    const response = await fetch(`${url}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "question", draft: "blocked draft" }),
    });
    assert.equal(response.status, 422);
    const body = await response.json() as { answer?: string; error?: { code?: string; report?: { passed?: boolean } } };
    assert.equal(body.answer, undefined);
    assert.equal(body.error?.code, "claimlatch_blocked");
    assert.equal(body.error?.report?.passed, false);
  });
});

test("guarded answer HTTP integration rejects malformed requests", async () => {
  await withGuardedAnswerServer(async (url) => {
    const response = await fetch(`${url}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "question" }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "invalid_request_error");
  });
});
