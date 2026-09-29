import type { Claim, Evidence, EvidenceProvider, SourceType } from "../types.js";

export interface TavilyEvidenceProviderOptions {
  apiKey: string;
  maxResults?: number;
  primaryDomains?: string[];
  fetchImpl?: typeof fetch;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export class TavilyEvidenceProvider implements EvidenceProvider {
  readonly #apiKey: string;
  readonly #maxResults: number;
  readonly #primaryDomains: Set<string>;
  readonly #fetch: typeof fetch;

  constructor(options: TavilyEvidenceProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#maxResults = Math.max(1, Math.min(options.maxResults ?? 5, 10));
    this.#primaryDomains = new Set((options.primaryDomains ?? []).map(normalizeDomain));
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async search(claim: Claim): Promise<Evidence[]> {
    const response = await this.#fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: this.#apiKey,
        query: claim.text,
        search_depth: "advanced",
        max_results: this.#maxResults,
        include_answer: false,
        include_images: false,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Tavily search failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const payload = (await response.json()) as TavilyResponse;
    const now = new Date().toISOString();
    const results = Array.isArray(payload.results) ? payload.results : [];

    return results
      .filter((result) => typeof result.url === "string" && typeof result.content === "string")
      .map((result, index) => {
        const url = result.url as string;
        return {
          id: `${claim.id}_ev_${index + 1}`,
          claimId: claim.id,
          title: result.title?.trim() || url,
          url,
          snippet: (result.content as string).trim(),
          sourceType: this.#classifySource(url),
          ...(result.published_date ? { publishedAt: result.published_date } : {}),
          retrievedAt: now,
          provider: "tavily",
          provenance: {
            kind: "search-snippet",
            sourceUrl: url,
            retrievedAt: now,
            quote: (result.content as string).trim(),
          },
        } satisfies Evidence;
      });
  }

  #classifySource(url: string): SourceType {
    try {
      const hostname = normalizeDomain(new URL(url).hostname);
      return [...this.#primaryDomains].some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
        ? "primary"
        : "unknown";
    } catch {
      return "unknown";
    }
  }
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}
