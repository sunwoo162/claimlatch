import { lookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Claim, Evidence, EvidenceProvider, EvidenceProvenance } from "../types.js";

export type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export interface PinnedRequestOptions {
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  maxBytes: number;
  method: string;
  signal: AbortSignal;
}

export type PinnedRequest = (url: URL, options: PinnedRequestOptions) => Promise<Response>;

export interface ProvenanceEvidenceProviderOptions {
  provider: EvidenceProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxDocumentBytes?: number;
  maxQuoteChars?: number;
  maxRedirects?: number;
  lookupImpl?: DnsLookup;
  requestImpl?: PinnedRequest;
}

export class ProvenanceEvidenceProvider implements EvidenceProvider {
  readonly #provider: EvidenceProvider;
  readonly #fetch: typeof fetch | undefined;
  readonly #lookup: DnsLookup;
  readonly #request: PinnedRequest;
  readonly #timeoutMs: number;
  readonly #maxDocumentBytes: number;
  readonly #maxQuoteChars: number;
  readonly #maxRedirects: number;

  constructor(options: ProvenanceEvidenceProviderOptions) {
    this.#provider = options.provider;
    this.#fetch = options.fetchImpl;
    this.#lookup = options.lookupImpl ?? lookupAllAddresses;
    this.#request = options.requestImpl ?? requestWithPinnedAddress;
    this.#timeoutMs = clampInteger(options.timeoutMs ?? 8_000, 250, 60_000);
    this.#maxDocumentBytes = clampInteger(options.maxDocumentBytes ?? 1_000_000, 1_024, 5_000_000);
    this.#maxQuoteChars = clampInteger(options.maxQuoteChars ?? 700, 120, 2_000);
    this.#maxRedirects = clampInteger(options.maxRedirects ?? 3, 0, 10);
  }

  async search(claim: Claim): Promise<Evidence[]> {
    const raw = await this.#provider.search(claim);
    return Promise.all(raw.map((evidence) => this.#hydrate(claim, evidence)));
  }

  async #hydrate(claim: Claim, evidence: Evidence): Promise<Evidence> {
    const fallback = withSearchSnippetProvenance(evidence);

    let url: URL;
    try {
      url = new URL(evidence.url);
    } catch {
      return fallback;
    }

    if (!isSafePublicHttpUrl(url)) return fallback;

    try {
      const fetched = await fetchPublicDocument({
        url,
        ...(this.#fetch ? { fetchImpl: this.#fetch } : {}),
        lookupImpl: this.#lookup,
        requestImpl: this.#request,
        timeoutMs: this.#timeoutMs,
        maxBytes: this.#maxDocumentBytes,
        maxRedirects: this.#maxRedirects,
      });
      if (!fetched) return fallback;

      const text = normalizeDocumentText(fetched.body, fetched.contentType);
      if (!text) return fallback;

      const selected = selectQuote(text, claim.text, this.#maxQuoteChars);
      if (!selected) return fallback;

      const provenance: EvidenceProvenance = {
        kind: "retrieved-document",
        sourceUrl: fetched.finalUrl,
        retrievedAt: fetched.retrievedAt,
        quote: selected.quote,
        quoteStart: selected.start,
        quoteEnd: selected.end,
        contentSha256: await sha256Hex(text),
        contentType: fetched.contentType,
      };

      return {
        ...evidence,
        url: fetched.finalUrl,
        snippet: selected.quote,
        retrievedAt: fetched.retrievedAt,
        provenance,
      };
    } catch {
      return fallback;
    }
  }
}

interface FetchedDocument {
  finalUrl: string;
  body: string;
  contentType: string;
  retrievedAt: string;
}

async function fetchPublicDocument(input: {
  url: URL;
  fetchImpl?: typeof fetch;
  lookupImpl: DnsLookup;
  requestImpl: PinnedRequest;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}): Promise<FetchedDocument | null> {
  let current = input.url;

  for (let redirect = 0; redirect <= input.maxRedirects; redirect += 1) {
    if (!isSafePublicHttpUrl(current)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const requestOptions = {
        method: "GET",
        redirect: "manual" as const,
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.1",
          "user-agent": "ClaimLatch/0.2 evidence fetcher",
        },
      };
      const response = input.fetchImpl
        ? await input.fetchImpl(current, requestOptions)
        : await fetchWithPinnedAddress(current, requestOptions, input.lookupImpl, input.requestImpl, input.maxBytes);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === input.maxRedirects) return null;
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) return null;

      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!isTextualContentType(contentType)) return null;

      const body = await readTextWithLimit(response, input.maxBytes);
      return {
        finalUrl: current.toString(),
        body,
        contentType: contentType || "text/plain",
        retrievedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

async function fetchWithPinnedAddress(
  url: URL,
  options: {
    method: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  },
  lookupImpl: DnsLookup,
  requestImpl: PinnedRequest,
  maxBytes: number,
): Promise<Response> {
  const addresses = await lookupImpl(url.hostname.replace(/^\[|\]$/g, ""), { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isSafePublicIp(address))) {
    throw new Error("Evidence hostname resolved to a non-public address.");
  }

  const selected = addresses[0];
  if (!selected) throw new Error("Evidence hostname did not resolve to an address.");
  return requestImpl(url, {
    ...options,
    address: selected.address,
    family: selected.family,
    maxBytes,
  });
}

async function lookupAllAddresses(hostname: string, options: { all: true; verbatim: true }): Promise<Array<{ address: string; family: 4 | 6 }>> {
  return lookup(hostname, options);
}

async function requestWithPinnedAddress(url: URL, options: PinnedRequestOptions): Promise<Response> {
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const requestOptions: RequestOptions = {
    hostname,
    ...(url.port ? { port: url.port } : {}),
    path: `${url.pathname}${url.search}`,
    method: options.method,
    headers: options.headers,
    signal: options.signal,
    ...(url.protocol === "https:" ? { servername: hostname } : {}),
    lookup: (_lookupHostname, _lookupOptions, callback) => {
      callback(null, options.address, options.family);
    },
  };

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = transport(requestOptions, (response) => {
      const chunks: Uint8Array[] = [];
      let total = 0;

      response.on("data", (chunk) => {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        total += bytes.byteLength;
        if (total > options.maxBytes) {
          request.destroy(new Error("Evidence document exceeds configured size limit."));
          fail(new Error("Evidence document exceeds configured size limit."));
          return;
        }
        chunks.push(bytes);
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const headers = Object.entries(response.headers).flatMap(([name, value]) => {
          if (Array.isArray(value)) return value.map((item) => [name, item] as [string, string]);
          return value === undefined ? [] : [[name, value] as [string, string]];
        });
        settled = true;
        resolve(new Response(new TextDecoder().decode(body), {
          status: response.statusCode ?? 500,
          headers,
        }));
      });
    });
    request.on("error", fail);
  });
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Evidence document exceeds configured size limit.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function isTextualContentType(contentType: string): boolean {
  return (
    contentType === "" ||
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "text/plain" ||
    contentType === "application/json" ||
    contentType.endsWith("+json")
  );
}

function normalizeDocumentText(body: string, contentType: string): string {
  if (contentType.includes("html") || /<html[\s>]/i.test(body)) {
    return htmlToText(body);
  }
  return collapseWhitespace(body);
}

function htmlToText(html: string): string {
  return collapseWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|\/tr)>/gi, ". ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, token: string) => {
    if (token[0] === "#") {
      const hex = token[1]?.toLowerCase() === "x";
      const parsed = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    }
    return named[token.toLowerCase()] ?? match;
  });
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function selectQuote(documentText: string, claimText: string, maxChars: number): { quote: string; start: number; end: number } | null {
  const claimTokens = new Set(tokenize(claimText));
  if (claimTokens.size === 0) return null;

  const candidates = sentenceRanges(documentText);
  let best: { start: number; end: number; overlap: number; score: number } | null = null;

  for (const candidate of candidates) {
    const sentence = documentText.slice(candidate.start, candidate.end);
    const sentenceTokens = new Set(tokenize(sentence));
    let overlap = 0;
    for (const token of claimTokens) if (sentenceTokens.has(token)) overlap += 1;
    if (overlap === 0) continue;

    const score = overlap / claimTokens.size;
    if (!best || score > best.score || (score === best.score && overlap > best.overlap)) {
      best = { ...candidate, overlap, score };
    }
  }

  if (!best) return null;

  let start = Math.max(0, best.start - Math.floor(maxChars * 0.15));
  let end = Math.min(documentText.length, Math.max(best.end, start + maxChars));
  if (end - start > maxChars) end = start + maxChars;

  const quote = documentText.slice(start, end).trim();
  if (!quote) return null;
  const actualStart = documentText.indexOf(quote, start);
  return { quote, start: actualStart, end: actualStart + quote.length };
}

function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = /[^.!?。！？]+(?:[.!?。！？]+|$)/gu;
  for (const match of text.matchAll(regex)) {
    const raw = match[0];
    const start = match.index;
    if (start === undefined || !raw.trim()) continue;
    const leftTrim = raw.length - raw.trimStart().length;
    const rightTrim = raw.length - raw.trimEnd().length;
    ranges.push({ start: start + leftTrim, end: start + raw.length - rightTrim });
  }
  return ranges.length > 0 ? ranges : [{ start: 0, end: text.length }];
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length > 1);
}

function withSearchSnippetProvenance(evidence: Evidence): Evidence {
  if (evidence.provenance) return evidence;
  return {
    ...evidence,
    provenance: {
      kind: "search-snippet",
      sourceUrl: evidence.url,
      retrievedAt: evidence.retrievedAt,
      quote: evidence.snippet,
    },
  };
}

export function isSafePublicHttpUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;

  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1" || hostname.startsWith("::ffff:")) return false;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(hostname) || /^fe[89ab][0-9a-f]:/i.test(hostname)) return false;

  const ipv4 = parseIpv4(hostname);
  if (!ipv4) return true;
  const [a, b] = ipv4;
  if (a === undefined || b === undefined) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isSafePublicIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(":")) {
    try {
      return isSafePublicHttpUrl(new URL(`http://[${normalized}]/`));
    } catch {
      return false;
    }
  }
  return isSafePublicHttpUrl(new URL(`http://${normalized}/`));
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
