#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  parseBenchmarkJsonl,
  parseBenchmarkManifest,
  runBenchmark,
  verifyBenchmarkManifestEntry,
} from "./benchmark.js";
import { formatBenchmarkReport, resolveBenchmarkOutputFormat } from "./benchmark-formatters.js";
import { resolveBenchmarkDatasetSelection } from "./benchmark-cli-options.js";
import { createDefaultClaimLatch } from "./default-gate.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const format = resolveBenchmarkOutputFormat(argv);
  const datasetArgument = argumentValue(argv, "--dataset");
  const splitArgument = argumentValue(argv, "--split");
  const datasetPath = resolveBenchmarkDatasetSelection(datasetArgument, splitArgument);
  const manifestPath = argumentValue(argv, "--manifest")
    ?? (datasetArgument ? undefined : new URL("../../benchmarks/MANIFEST.json", import.meta.url));
  const raw = await readFile(datasetPath, "utf8");
  const cases = parseBenchmarkJsonl(raw);
  if (manifestPath) {
    const manifest = parseBenchmarkManifest(await readFile(manifestPath, "utf8"));
    verifyBenchmarkManifestEntry(manifest, fileName(datasetPath), raw, cases.length);
  }

  const llmModel = process.env.CLAIMLATCH_LLM_MODEL;
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!llmModel) throw new Error("Set CLAIMLATCH_LLM_MODEL for the verifier model.");
  if (!tavilyApiKey) throw new Error("Set TAVILY_API_KEY for evidence retrieval.");

  const llmApiKey = process.env.CLAIMLATCH_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const llmBaseUrl = process.env.CLAIMLATCH_LLM_BASE_URL;
  const gate = createDefaultClaimLatch({
    llmModel,
    tavilyApiKey,
    ...(llmApiKey ? { llmApiKey } : {}),
    ...(llmBaseUrl ? { llmBaseUrl } : {}),
  });

  const report = await runBenchmark(gate, cases);
  const artifactUri = typeof datasetPath === "string" ? datasetPath : `benchmarks/${fileName(datasetPath)}`;
  process.stdout.write(formatBenchmarkReport(report, format, { artifactUri }));

  process.exitCode = report.falsePasses === 0 ? 0 : 1;
}

function argumentValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a value.`);
  return value;
}

function fileName(path: string | URL): string {
  const value = typeof path === "string" ? path : path.pathname;
  const segments = value.split(/[\\/]/u);
  return decodeURIComponent(segments[segments.length - 1] ?? "");
}

main().catch((error: unknown) => {
  process.stderr.write(`claimlatch-bench: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
