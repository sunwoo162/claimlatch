import {
  createDefaultClaimLatch,
  createGuardedAnswerFetchHandler,
  type GuardedAnswerFetchHandler,
} from "../src/index.js";

export interface FastifyRequest {
  method?: string;
  protocol?: string;
  hostname?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

export interface FastifyReply {
  code(statusCode: number): FastifyReply;
  header(name: string, value: string | string[]): FastifyReply;
  send(payload: string): FastifyReply;
}

let cachedHandler: GuardedAnswerFetchHandler | undefined;

function getHandler(): GuardedAnswerFetchHandler {
  if (cachedHandler) return cachedHandler;

  const llmModel = process.env.CLAIMLATCH_LLM_MODEL;
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!llmModel) throw new Error("Set CLAIMLATCH_LLM_MODEL.");
  if (!tavilyApiKey) throw new Error("Set TAVILY_API_KEY.");

  const gate = createDefaultClaimLatch({
    llmModel,
    tavilyApiKey,
    ...(process.env.CLAIMLATCH_LLM_API_KEY ? { llmApiKey: process.env.CLAIMLATCH_LLM_API_KEY } : {}),
    ...(process.env.CLAIMLATCH_LLM_BASE_URL ? { llmBaseUrl: process.env.CLAIMLATCH_LLM_BASE_URL } : {}),
  });
  cachedHandler = createGuardedAnswerFetchHandler({
    gate,
    policy: {
      minimumCoverage: 1,
      maxUnsupportedClaims: 0,
      maxUnverifiableClaims: 0,
      blockOnContradiction: true,
    },
  });
  return cachedHandler;
}

export function createFastifyGuardedAnswerHandler(
  fetchHandler: GuardedAnswerFetchHandler = getHandler(),
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const protocol = request.protocol ?? "http";
    const host = request.hostname ?? getHeaderValue(request.headers?.host) ?? "localhost";
    const path = request.url ?? "/";
    const method = request.method ?? "GET";
    const init: RequestInit = { method };
    if (request.body !== undefined && method !== "GET" && method !== "HEAD") {
      const body = JSON.stringify(request.body);
      if (body === undefined) throw new TypeError("Fastify request body must be JSON-serializable.");
      init.body = body;
      init.headers = { "content-type": "application/json" };
    }

    const upstreamResponse = await fetchHandler(new Request(new URL(path, `${protocol}://${host}`), init));
    upstreamResponse.headers.forEach((value, name) => reply.header(name, value));
    reply.code(upstreamResponse.status).send(await upstreamResponse.text());
  };
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Copy this adapter into a Fastify route after enabling Fastify's JSON parser.
