export interface CalibrationCliArguments {
  calibrationPath: string;
  evaluationPath: string;
  outputPath: string;
  profileId: string;
  scorerId: string;
  createdAt: string;
  json: boolean;
}

const VALUE_OPTIONS = new Set([
  "--calibration",
  "--evaluation",
  "--output",
  "--profile-id",
  "--scorer-id",
  "--created-at",
]);

export function parseCalibrationCliArguments(argv: readonly string[]): CalibrationCliArguments {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--json") {
      json = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(option ?? "")) {
      throw new Error(`Unknown calibration CLI option: ${option ?? ""}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
    values.set(option!, value);
    index += 1;
  }

  for (const option of VALUE_OPTIONS) {
    if (!values.has(option)) throw new Error(`${option} is required.`);
  }

  return {
    calibrationPath: values.get("--calibration")!,
    evaluationPath: values.get("--evaluation")!,
    outputPath: values.get("--output")!,
    profileId: values.get("--profile-id")!,
    scorerId: values.get("--scorer-id")!,
    createdAt: values.get("--created-at")!,
    json,
  };
}

export function renderCalibrationHelp(): string {
  return [
    "ClaimLatch confidence calibration",
    "",
    "Usage:",
    "  claimlatch-calibrate [options]",
    "",
    "Options:",
    "  --calibration <path>            Claim-level calibration JSONL dataset",
    "  --evaluation <path>             Independent evaluation JSONL dataset",
    "  --output <path>                 Write the validated profile JSON",
    "  --profile-id <id>               Calibration profile identifier",
    "  --scorer-id <id>                Raw score provider identifier",
    "  --created-at <ISO-8601>         Reproducible profile creation timestamp",
    "  --json                          Print deterministic evaluation JSON",
    "  -h, --help                      Show this help",
    "",
    "Confidence is verification-status-correctness probability, not factual truth probability.",
    "Calibration is offline-only and requires independent labelled evaluation data.",
    "",
  ].join("\n");
}
