#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseBenchmarkJsonl, runBenchmark } from "./benchmark.js";
import { createDefaultClaimLatch } from "./default-gate.js";

async function main(): Promise<void> {
  const datasetPath = argumentValue(process.argv.slice(2), "--dataset")
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
  const json = process.argv.includes("--json");
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderBenchmark(report));
  }

  process.exitCode = report.falsePasses === 0 ? 0 : 1;
}

function argumentValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a value.`);
  return value;
}

function renderBenchmark(report: Awaited<ReturnType<typeof runBenchmark>>): string {
  const lines = [
    "ClaimLatch benchmark",
    "",
    `Cases             ${report.total}`,
    `Decision accuracy ${(report.decisionAccuracy * 100).toFixed(1)}%`,
    `False passes      ${report.falsePasses}/${report.negativeCases} (${(report.falsePassRate * 100).toFixed(1)}%)`,
    `False blocks      ${report.falseBlocks}/${report.positiveCases} (${(report.falseBlockRate * 100).toFixed(1)}%)`,
    "",
  ];

  for (const item of report.cases.filter((candidate) => !candidate.correct)) {
    lines.push(
      `${item.falsePass ? "FALSE PASS" : "FALSE BLOCK"}  ${item.id}`,
      `  expected=${item.expectedPassed ? "PASS" : "BLOCK"} actual=${item.actualPassed ? "PASS" : "BLOCK"}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`claimlatch-bench: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
