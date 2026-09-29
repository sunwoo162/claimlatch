import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ClaimLatch } from "./gate.js";
import type { GatePolicy, VerificationInput, VerificationReport } from "./types.js";

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

export interface GuardedAnswerServerOptions {
  gate: ClaimLatch;
  policy?: Partial<GatePolicy>;
  maxRequestBytes?: number;
}

export interface GuardedAnswerServer {
  server: Server;
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_GUARDED_ANSWER_MAX_REQUEST_BYTES = 1_000_000;

export function createGuardedAnswerServer(options: GuardedAnswerServerOptions): GuardedAnswerServer {
  const maxRequestBytes = normalizeMaxRequestBytes(
    options.maxRequestBytes ?? DEFAULT_GUARDED_ANSWER_MAX_REQUEST_BYTES,
  );
  const server = createServer(async (request, response) => {
    try {
      await handleGuardedAnswerRequest(request, response, options, maxRequestBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        writeIntegrationJson(response, 413, {
          error: {
            type: "invalid_request_error",
            code: "request_too_large",
            message: "Request body exceeds the configured size limit.",
          },
        });
        return;
      }
      writeIntegrationJson(response, 502, {
        error: {
          type: "claimlatch_integration_error",
          code: "claimlatch_verification_error",
          message: "ClaimLatch verification failed; the answer was not released.",
        },
      });
    }
  });

  return {
    server,
    listen(port: number, host = "127.0.0.1") {
      return new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function handleGuardedAnswerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: GuardedAnswerServerOptions,
  maxRequestBytes: number,
): Promise<void> {
  const path = request.url?.split("?")[0] ?? "/";
  if (request.method === "GET" && path === "/health") {
    writeIntegrationJson(response, 200, { ok: true, service: "claimlatch-guarded-answer" });
    return;
  }
  if (request.method !== "POST" || path !== "/answer") {
    writeIntegrationJson(response, 404, {
      error: { type: "not_found", code: "not_found", message: "Route not found." },
    });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readIntegrationRequestBody(request, maxRequestBytes)) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    writeIntegrationJson(response, 400, {
      error: { type: "invalid_request_error", code: "invalid_json", message: "Request body must be valid JSON." },
    });
    return;
  }

  const input = parseGuardedAnswerInput(payload);
  if (!input) {
    writeIntegrationJson(response, 400, {
      error: {
        type: "invalid_request_error",
        code: "invalid_request_error",
        message: "Request body must contain non-empty string fields: question and draft.",
      },
    });
    return;
  }

  try {
    const verified = await verifyBeforeRelease(options.gate, {
      question: input.question,
      answer: input.draft,
      ...(options.policy ? { policy: options.policy } : {}),
    });
    writeIntegrationJson(response, 200, verified);
  } catch (error) {
    if (error instanceof ClaimLatchBlockedError) {
      writeIntegrationJson(response, 422, {
        error: {
          type: "claimlatch_blocked",
          code: "claimlatch_blocked",
          message: "ClaimLatch blocked the answer; do not release it to the user.",
          report: error.report,
        },
      });
      return;
    }
    throw error;
  }
}

function parseGuardedAnswerInput(payload: unknown): { question: string; draft: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.question !== "string" || typeof record.draft !== "string") return null;
  const question = record.question.trim();
  const draft = record.draft.trim();
  return question && draft ? { question, draft } : null;
}

async function readIntegrationRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    total += bytes.byteLength;
    if (total > maxBytes) throw new RequestBodyTooLargeError();
    chunks.push(bytes);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function writeIntegrationJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function normalizeMaxRequestBytes(value: number): number {
  if (!Number.isFinite(value) || value < 1_024 || value > 10_000_000) {
    throw new Error("maxRequestBytes must be a finite number between 1024 and 10000000.");
  }
  return Math.floor(value);
}

class RequestBodyTooLargeError extends Error {}
