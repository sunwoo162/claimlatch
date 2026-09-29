#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseBenchmarkJsonl, runBenchmark } from "./benchmark.js";
import { formatBenchmarkReport, resolveBenchmarkOutputFormat } from "./benchmark-formatters.js";
import { createDefaultClaimLatch } from "./default-gate.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const format = resolveBenchmarkOutputFormat(argv);
  const datasetPath = argumentValue(argv, "--dataset")
    ?? new URL("../../benchmarks/independent.jsonl", import.meta.url);
  const raw = await readFile(datasetPath, "utf8");
  const cases = parseBenchmarkJsonl(raw);

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
  const artifactUri = typeof datasetPath === "string" ? datasetPath : "benchmarks/independent.jsonl";
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

main().catch((error: unknown) => {
  process.stderr.write(`claimlatch-bench: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
