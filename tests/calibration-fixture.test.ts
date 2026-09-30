import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createConfidenceCalibrationProfile,
  hashCalibrationDataset,
  parseCalibrationJsonl,
} from "../src/calibration.js";

const calibrationPath = join("benchmarks", "confidence-calibration.jsonl");
const evaluationPath = join("benchmarks", "confidence-evaluation.jsonl");
const profilePath = join("benchmarks", "confidence-profile.json");
const metricsPath = join("benchmarks", "confidence-evaluation.json");

test("committed confidence calibration fixture reproduces its profile and metrics", async () => {
  const calibrationContent = await readFile(calibrationPath, "utf8");
  const evaluationContent = await readFile(evaluationPath, "utf8");
  const calibration = parseCalibrationJsonl(calibrationContent);
  const evaluation = parseCalibrationJsonl(evaluationContent);
  const generated = createConfidenceCalibrationProfile({
    id: "claimlatch-status-fixture-v1",
    scorerId: "claimlatch-fixture-scorer-v1",
    calibration: {
      manifestSha256: hashCalibrationDataset(calibrationContent),
      observations: calibration,
    },
    evaluation: {
      manifestSha256: hashCalibrationDataset(evaluationContent),
      observations: evaluation,
    },
    createdAt: "2026-09-30T00:00:00.000Z",
  });

  assert.equal(calibration.length, 12);
  assert.equal(evaluation.length, 12);
  const calibrationPairs = new Set(calibration.map((observation) => `${observation.sourceCaseId}/${observation.sourceClaimId}`));
  assert.ok(evaluation.every((observation) => !calibrationPairs.has(`${observation.sourceCaseId}/${observation.sourceClaimId}`)));
  assert.deepEqual(JSON.parse(await readFile(profilePath, "utf8")), generated.profile);
  assert.deepEqual(JSON.parse(await readFile(metricsPath, "utf8")), generated.evaluation);
});
