export interface ReceiptVerificationJsonInput {
  valid: boolean;
  filePath: string;
  publicKeyPath?: string;
  receipt: unknown;
}

export function renderReceiptVerificationJson(input: ReceiptVerificationJsonInput): string {
  const receipt = asRecord(input.receipt);
  const payload = asRecord(receipt?.payload);
  const report = asRecord(payload?.report);
  const passed = input.valid && typeof report?.passed === "boolean" ? report.passed : undefined;
  const generatedAt =
    input.valid && typeof report?.generatedAt === "string" && report.generatedAt.length > 0
      ? report.generatedAt
      : undefined;
  return JSON.stringify({
    valid: input.valid,
    file: input.filePath,
    ...(receipt?.version === 1 ? { version: 1 } : {}),
    ...(receipt?.algorithm === "Ed25519" ? { algorithm: "Ed25519" } : {}),
    ...(typeof payload?.keyId === "string" ? { keyId: payload.keyId } : {}),
    ...(input.publicKeyPath ? { publicKeyFile: input.publicKeyPath } : {}),
    ...(passed !== undefined ? { decision: passed ? "PASS" : "BLOCK" } : {}),
    ...(generatedAt !== undefined ? { generatedAt } : {}),
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
