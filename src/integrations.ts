import type { ClaimLatch } from "./gate.js";
import type { VerificationInput, VerificationReport } from "./types.js";

export interface VerifiedAnswer {
  answer: string;
  report: VerificationReport;
}

export class ClaimLatchBlockedError extends Error {
  readonly report: VerificationReport;

  constructor(report: VerificationReport) {
    super("ClaimLatch blocked the answer; do not release it to the user.");
    this.name = "ClaimLatchBlockedError";
    this.report = report;
  }
}

export async function verifyBeforeRelease(
  gate: ClaimLatch,
  input: VerificationInput,
): Promise<VerifiedAnswer> {
  const report = await gate.verify(input);
  if (!report.passed) {
    throw new ClaimLatchBlockedError(report);
  }

  return { answer: input.answer, report };
}
