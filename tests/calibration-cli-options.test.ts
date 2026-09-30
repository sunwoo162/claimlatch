import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCalibrationCliArguments,
  renderCalibrationHelp,
} from "../src/calibration-cli-options.js";

test("calibration CLI help documents status-correctness semantics", () => {
  const help = renderCalibrationHelp();

  assert.match(help, /Usage:\s+claimlatch-calibrate/);
  assert.match(help, /--calibration <path>/);
  assert.match(help, /--evaluation <path>/);
  assert.match(help, /--output <path>/);
  assert.match(help, /--profile-id <id>/);
  assert.match(help, /--scorer-id <id>/);
  assert.match(help, /--created-at <ISO-8601>/);
  assert.match(help, /not factual truth probability/);
});

test("calibration CLI parser preserves required arguments", () => {
  assert.deepEqual(parseCalibrationCliArguments([
    "--calibration", "calibration.jsonl",
    "--evaluation", "evaluation.jsonl",
    "--output", "profile.json",
    "--profile-id", "profile-v1",
    "--scorer-id", "scorer-v1",
    "--created-at", "2026-09-30T00:00:00.000Z",
    "--json",
  ]), {
    calibrationPath: "calibration.jsonl",
    evaluationPath: "evaluation.jsonl",
    outputPath: "profile.json",
    profileId: "profile-v1",
    scorerId: "scorer-v1",
    createdAt: "2026-09-30T00:00:00.000Z",
    json: true,
  });
});

test("calibration CLI parser rejects missing or unknown arguments", () => {
  assert.throws(
    () => parseCalibrationCliArguments(["--calibration", "calibration.jsonl"]),
    /--evaluation is required/,
  );
  assert.throws(
    () => parseCalibrationCliArguments([
      "--calibration", "calibration.jsonl",
      "--evaluation", "evaluation.jsonl",
      "--output", "profile.json",
      "--profile-id", "profile-v1",
      "--scorer-id", "scorer-v1",
      "--created-at", "2026-09-30T00:00:00.000Z",
      "--unexpected",
    ]),
    /Unknown calibration CLI option/,
  );
});
