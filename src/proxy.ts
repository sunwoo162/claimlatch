import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ClaimLatch } from "./gate.js";
import { calculateCoverage } from "./policy.js";
import type { GatePolicy, VerificationCounts, VerificationReport } from "./types.js";

export interface OpenAIProxyOptions {
  gate: ClaimLatch;
  upstreamBaseUrl: string;
  upstreamApiKey?: string;
  policy?: Partial<GatePolicy>;
  fetchImpl?: typeof fetch;
  maxRequestBytes?: number;
  maxBufferedResponseBytes?: number;
  maxBufferedChoices?: number;
  maxBufferedChoiceBytes?: number;
}

export interface OpenAIProxyServer {
  server: Server;
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

interface ChatMessage {
  role?: unknown;
  content?: unknown;
}

interface ChatRequest {
  stream?: unknown;
  messages?: unknown;
  [key: string]: unknown;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  [key: string]: unknown;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const REQUEST_HEADERS_TO_STRIP = new Set([
  ...HOP_BY_HOP_HEADERS,
  "authorization",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
]);

const RESPONSE_HEADERS_TO_FORWARD = new Set([
  "content-type",
  "retry-after",
  "x-request-id",
]);

export function createOpenAIProxy(options: OpenAIProxyOptions): OpenAIProxyServer {
  const baseUrl = options.upstreamBaseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRequestBytes = clampInteger(options.maxRequestBytes ?? 2_000_000, 1_024, 10_000_000);
  const maxBufferedResponseBytes = clampInteger(options.maxBufferedResponseBytes ?? 10_000_000, 1_024, 50_000_000);
  const maxBufferedChoices = clampInteger(options.maxBufferedChoices ?? 16, 1, 128);
  const maxBufferedChoiceBytes = clampInteger(options.maxBufferedChoiceBytes ?? 2_000_000, 1_024, 10_000_000);

  const server = createServer(async (request, response) => {
    try {
      await handleRequest({
        request,
        response,
        options,
        baseUrl,
        fetchImpl,
        maxRequestBytes,
        maxBufferedResponseBytes,
        maxBufferedChoices,
        maxBufferedChoiceBytes,
      });
    } catch (error) {
      writeJson(response, 500, {
        error: {
          type: "claimlatch_proxy_error",
          code: "claimlatch_proxy_error",
          message: error instanceof Error ? error.message : String(error),
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

async function handleRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  options: OpenAIProxyOptions;
  baseUrl: string;
  fetchImpl: typeof fetch;
  maxRequestBytes: number;
  maxBufferedResponseBytes: number;
  maxBufferedChoices: number;
  maxBufferedChoiceBytes: number;
}): Promise<void> {
  const { request, response } = input;
  const path = request.url?.split("?")[0] ?? "/";

  if (request.method === "GET" && path === "/health") {
    writeJson(response, 200, { ok: true, service: "claimlatch-proxy" });
    return;
  }

  if (request.method !== "POST" || (path !== "/v1/chat/completions" && path !== "/chat/completions")) {
    writeJson(response, 404, {
      error: { type: "not_found", code: "not_found", message: "Route not found." },
    });
    return;
  }

  const bodyText = await readRequestBody(request, input.maxRequestBytes);
  let body: ChatRequest;
  try {
    body = JSON.parse(bodyText) as ChatRequest;
  } catch {
    writeJson(response, 400, {
      error: { type: "invalid_request_error", code: "invalid_json", message: "Request body must be valid JSON." },
    });
    return;
  }

  const question = lastUserMessageText(body.messages);
  if (!question) {
    writeJson(response, 400, {
      error: {
        type: "invalid_request_error",
        code: "claimlatch_missing_user_message",
        message: "A textual user message is required so ClaimLatch can verify the generated answer in context.",
      },
    });
    return;
  }

  const incomingAuthorization = headerValue(request.headers.authorization);
  const authorization = input.options.upstreamApiKey
    ? `Bearer ${input.options.upstreamApiKey}`
    : incomingAuthorization;

  const upstream = await input.fetchImpl(`${input.baseUrl}/chat/completions`, {
    method: "POST",
    headers: upstreamRequestHeaders(request, authorization),
    body: bodyText,
  });

  if (!upstream.ok) {
    const upstreamText = await upstream.text();
    response.statusCode = upstream.status;
    const copiedContentType = copyResponseHeaders(upstream, response);
    if (!copiedContentType) response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(upstreamText);
    return;
  }

  if (body.stream === true) {
    let streamText: string;
    let answers: string[] | null;
    try {
      streamText = await readBufferedResponse(upstream, input.maxBufferedResponseBytes);
      answers = streamingAssistantTexts(streamText, input.maxBufferedChoices, input.maxBufferedChoiceBytes);
    } catch {
      writeJson(response, 502, {
        error: {
          type: "claimlatch_upstream_error",
          code: "claimlatch_invalid_upstream_stream",
          message: "Upstream returned a malformed, truncated, or unsupported chat completion stream.",
        },
      });
      return;
    }

    if (!answers) {
      writeJson(response, 502, {
        error: {
          type: "claimlatch_upstream_error",
          code: "claimlatch_missing_assistant_text",
          message: "Upstream chat completion stream did not contain textual assistant output.",
        },
      });
      return;
    }

    const reports = await Promise.all(answers.map((answer) => input.options.gate.verify({
      question,
      answer,
      ...(input.options.policy ? { policy: input.options.policy } : {}),
    })));
    const report = aggregateReports(reports);

    setGateHeaders(response, report);
    if (!report.passed) {
      writeJson(response, 422, {
        error: {
          type: "claimlatch_blocked",
          code: "claimlatch_blocked",
          message: "ClaimLatch blocked the generated answer because it did not satisfy the configured evidence policy.",
        },
        claimlatch: report,
        claimlatchReports: reports,
      });
      return;
    }

    copyResponseHeaders(upstream, response);
    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream");
    response.end(streamText);
    return;
  }

  const upstreamText = await upstream.text();

  let payload: ChatCompletionResponse;
  try {
    payload = JSON.parse(upstreamText) as ChatCompletionResponse;
  } catch {
    writeJson(response, 502, {
      error: {
        type: "claimlatch_upstream_error",
        code: "claimlatch_invalid_upstream_json",
        message: "Upstream returned a non-JSON chat completion.",
      },
    });
    return;
  }

  const answers = assistantTexts(payload);
  if (!answers) {
    writeJson(response, 502, {
      error: {
        type: "claimlatch_upstream_error",
        code: "claimlatch_missing_assistant_text",
        message: "Upstream chat completion did not contain textual assistant output.",
      },
    });
    return;
  }

  const reports = await Promise.all(answers.map((answer) => input.options.gate.verify({
    question,
    answer,
    ...(input.options.policy ? { policy: input.options.policy } : {}),
  })));
  const report = aggregateReports(reports);

  setGateHeaders(response, report);
  if (!report.passed) {
    writeJson(response, 422, {
      error: {
        type: "claimlatch_blocked",
        code: "claimlatch_blocked",
        message: "ClaimLatch blocked the generated answer because it did not satisfy the configured evidence policy.",
      },
      claimlatch: report,
      claimlatchReports: reports,
    });
    return;
  }

  response.statusCode = 200;
  const copiedContentType = copyResponseHeaders(upstream, response);
  if (!copiedContentType) response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(upstreamText);
}

function upstreamRequestHeaders(request: IncomingMessage, authorization: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };

  for (const [rawName, rawValue] of Object.entries(request.headers)) {
    const name = rawName.toLowerCase();
    if (REQUEST_HEADERS_TO_STRIP.has(name) || rawValue === undefined) continue;
    headers[name] = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
  }

  if (authorization) headers.authorization = authorization;
  return headers;
}

function copyResponseHeaders(upstream: Response, response: ServerResponse): boolean {
  let copiedContentType = false;
  for (const [name, value] of upstream.headers) {
    const normalizedName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedName)) continue;
    if (
      RESPONSE_HEADERS_TO_FORWARD.has(normalizedName)
      || normalizedName.startsWith("openai-")
      || normalizedName.startsWith("x-ratelimit-")
      || normalizedName.startsWith("ratelimit-")
    ) {
      response.setHeader(name, value);
      if (normalizedName === "content-type") copiedContentType = true;
    }
  }
  return copiedContentType;
}

function lastUserMessageText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const raw = messages[index];
    if (!raw || typeof raw !== "object") continue;
    const message = raw as ChatMessage;
    if (message.role !== "user") continue;
    const text = contentToText(message.content);
    if (text) return text;
  }
  return null;
}

function assistantTexts(payload: ChatCompletionResponse): string[] | null {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) return null;

  const texts = payload.choices.map((choice) => contentToText(choice?.message?.content));
  if (texts.some((text): text is null => text === null)) return null;
  return texts as string[];
}

function streamingAssistantTexts(streamText: string, maxChoices: number, maxChoiceBytes: number): string[] | null {
  const normalized = streamText.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  if (!normalized.endsWith("\n\n")) throw new Error("SSE stream did not end at a complete frame.");

  const contentByIndex = new Map<number, string>();
  const choiceIndexes = new Set<number>();
  const blocks = normalized.split("\n\n");
  let done = false;

  for (const block of blocks.slice(0, -1)) {
    const dataLines: string[] = [];
    let eventType: string | undefined;
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventType = line.slice("event:".length).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).replace(/^ /u, ""));
        continue;
      }
      if (line.trim()) throw new Error("SSE stream contained an unsupported field.");
    }

    if (dataLines.length === 0) continue;
    if (done) throw new Error("SSE stream contained data after [DONE].");
    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    if (eventType === "error") throw new Error("SSE stream contained an error event.");

    const payload = JSON.parse(data) as Record<string, unknown>;
    if (payload.error !== undefined) throw new Error("SSE stream contained an error payload.");
    if (!Array.isArray(payload.choices)) throw new Error("SSE frame did not contain choices.");

    const frameIndexes = new Set<number>();
    for (const rawChoice of payload.choices) {
      if (!rawChoice || typeof rawChoice !== "object") throw new Error("SSE choice is malformed.");
      const choice = rawChoice as Record<string, unknown>;
      if (!Number.isInteger(choice.index) || (choice.index as number) < 0) {
        throw new Error("SSE choice index is malformed.");
      }
      const index = choice.index as number;
      if (frameIndexes.has(index)) throw new Error("SSE frame contained a duplicate choice index.");
      frameIndexes.add(index);
      if (!choiceIndexes.has(index) && choiceIndexes.size >= maxChoices) {
        throw new Error("SSE stream exceeded the configured choice limit.");
      }
      choiceIndexes.add(index);
      if (!choice.delta || typeof choice.delta !== "object") throw new Error("SSE delta is malformed.");
      const delta = choice.delta as Record<string, unknown>;
      if (delta.content === undefined || delta.content === null) continue;
      const content = streamingContentToText(delta.content);
      const combined = `${contentByIndex.get(index) ?? ""}${content}`;
      if (new TextEncoder().encode(combined).byteLength > maxChoiceBytes) {
        throw new Error("SSE choice exceeded the configured text limit.");
      }
      contentByIndex.set(index, combined);
    }
  }

  if (!done || choiceIndexes.size === 0) throw new Error("SSE stream did not contain a complete textual response.");
  const answers = [...choiceIndexes].sort((left, right) => left - right).map((index) => contentByIndex.get(index));
  if (answers.some((answer): answer is undefined => answer === undefined || answer.length === 0)) return null;
  return answers as string[];
}

function streamingContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("SSE delta content is not textual.");

  let text = "";
  for (const part of content) {
    if (!part || typeof part !== "object") throw new Error("SSE delta content part is malformed.");
    const record = part as Record<string, unknown>;
    if (record.type !== "text" || typeof record.text !== "string") {
      throw new Error("SSE delta contains unsupported non-text content.");
    }
    text += record.text;
  }
  return text;
}

async function readBufferedResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error("Upstream response did not contain a readable body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Buffered upstream response exceeds the configured size limit.");
      text += decoder.decode(value, { stream: true });
    }
    completed = true;
    return text + decoder.decode();
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function aggregateReports(reports: VerificationReport[]): VerificationReport {
  const counts: VerificationCounts = {
    total: 0,
    supported: 0,
    contradicted: 0,
    unsupported: 0,
    unverifiable: 0,
  };

  for (const report of reports) {
    counts.total += report.counts.total;
    counts.supported += report.counts.supported;
    counts.contradicted += report.counts.contradicted;
    counts.unsupported += report.counts.unsupported;
    counts.unverifiable += report.counts.unverifiable;
  }

  const generatedAt = reports.reduce(
    (latest, report) => report.generatedAt > latest ? report.generatedAt : latest,
    reports[0]?.generatedAt ?? new Date().toISOString(),
  );

  return {
    passed: reports.every((report) => report.passed),
    coverage: calculateCoverage(counts),
    counts,
    claims: reports.flatMap((report) => report.claims),
    violations: reports.flatMap((report) => report.violations),
    generatedAt,
  };
}

function contentToText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;

  const parts = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean);
  const joined = parts.join("\n").trim();
  return joined || null;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error("Request body exceeds configured size limit.");
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

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function setGateHeaders(response: ServerResponse, report: VerificationReport): void {
  response.setHeader("x-claimlatch-result", report.passed ? "pass" : "blocked");
  response.setHeader("x-claimlatch-coverage", report.coverage.toFixed(3));
  response.setHeader("x-claimlatch-claims", String(report.counts.total));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
