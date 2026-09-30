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

  const createdAt = values.get("--created-at")!;
  if (!isIso8601Timestamp(createdAt)) {
    throw new Error("--created-at must be a valid ISO-8601 timestamp.");
  }

  return {
    calibrationPath: values.get("--calibration")!,
    evaluationPath: values.get("--evaluation")!,
    outputPath: values.get("--output")!,
    profileId: values.get("--profile-id")!,
    scorerId: values.get("--scorer-id")!,
    createdAt,
    json,
  };
}

function isIso8601Timestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const offset = match[7];
  if (!offset) return false;
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  return Number.isFinite(Date.parse(value));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
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
