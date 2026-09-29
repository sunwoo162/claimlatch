import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseBenchmarkJsonl, runBenchmark } from "../src/benchmark.js";
import { ClaimLatch } from "../src/gate.js";
import type { ClaimExtractor, ClaimVerifier, EvidenceProvider } from "../src/types.js";

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
      retrievedAt: "2026-09-28T00:00:00.000Z",
      provider: "fixture",
    }];
  },
};

const verifier: ClaimVerifier = {
  async verify({ claim, evidence }) {
    const status = claim.text === "true" ? "SUPPORTED" as const : "CONTRADICTED" as const;
    return { claim, status, reason: "fixture", evidenceIds: ["e1"], evidence };
  },
};

test("benchmark reports false-pass and false-block rates against independent labels", async () => {
  const gate = new ClaimLatch({ extractor, evidenceProvider, verifier });
  const report = await runBenchmark(gate, [
    { id: "positive", question: "q", answer: "true", expectedPassed: true },
    { id: "negative", question: "q", answer: "false", expectedPassed: false },
  ]);

  assert.equal(report.decisionAccuracy, 1);
  assert.equal(report.falsePassRate, 0);
  assert.equal(report.falseBlockRate, 0);
});

test("benchmark JSONL parser rejects duplicate IDs", () => {
  assert.throws(() => parseBenchmarkJsonl([
    JSON.stringify({ id: "same", question: "q", answer: "a", expectedPassed: true }),
    JSON.stringify({ id: "same", question: "q2", answer: "a2", expectedPassed: false }),
  ].join("\n")), /Duplicate benchmark id/);
});

test("independent benchmark contains a balanced expanded label set", async () => {
  const raw = await readFile(new URL("../../benchmarks/independent.jsonl", import.meta.url), "utf8");
  const cases = parseBenchmarkJsonl(raw);
  const sourceUrls = new Set(cases.flatMap((item) => item.labelSourceUrls ?? []));

  assert.equal(cases.length, 32);
  assert.equal(cases.filter((item) => item.expectedPassed).length, 16);
  assert.equal(cases.filter((item) => !item.expectedPassed).length, 16);
  assert.ok(sourceUrls.size >= 8);
  assert.ok(cases.every((item) => (item.labelSourceUrls?.length ?? 0) > 0));
});
