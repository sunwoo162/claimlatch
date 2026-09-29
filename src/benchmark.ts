import type { ClaimLatch } from "./gate.js";
import type { VerificationReport } from "./types.js";

export interface BenchmarkCase {
  id: string;
  question: string;
  answer: string;
  expectedPassed: boolean;
  labelSourceUrls?: string[];
  note?: string;
}

export interface BenchmarkCaseResult {
  id: string;
  expectedPassed: boolean;
  actualPassed: boolean;
  correct: boolean;
  falsePass: boolean;
  falseBlock: boolean;
  report: VerificationReport;
}

export interface BenchmarkReport {
  total: number;
  correct: number;
  decisionAccuracy: number;
  negativeCases: number;
  positiveCases: number;
  falsePasses: number;
  falseBlocks: number;
  falsePassRate: number;
  falseBlockRate: number;
  cases: BenchmarkCaseResult[];
}

export async function runBenchmark(gate: ClaimLatch, cases: readonly BenchmarkCase[]): Promise<BenchmarkReport> {
  const results: BenchmarkCaseResult[] = [];

  for (const benchmarkCase of cases) {
    const report = await gate.verify({
      question: benchmarkCase.question,
      answer: benchmarkCase.answer,
    });
    const falsePass = !benchmarkCase.expectedPassed && report.passed;
    const falseBlock = benchmarkCase.expectedPassed && !report.passed;
    results.push({
      id: benchmarkCase.id,
      expectedPassed: benchmarkCase.expectedPassed,
      actualPassed: report.passed,
      correct: benchmarkCase.expectedPassed === report.passed,
      falsePass,
      falseBlock,
      report,
    });
  }

  const correct = results.filter((item) => item.correct).length;
  const falsePasses = results.filter((item) => item.falsePass).length;
  const falseBlocks = results.filter((item) => item.falseBlock).length;
  const negativeCases = cases.filter((item) => !item.expectedPassed).length;
  const positiveCases = cases.filter((item) => item.expectedPassed).length;

  return {
    total: results.length,
    correct,
    decisionAccuracy: ratio(correct, results.length),
    negativeCases,
    positiveCases,
    falsePasses,
    falseBlocks,
    falsePassRate: ratio(falsePasses, negativeCases),
    falseBlockRate: ratio(falseBlocks, positiveCases),
    cases: results,
  };
}

export function parseBenchmarkJsonl(input: string): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  const ids = new Set<string>();

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid benchmark JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== "object") throw new Error(`Benchmark line ${index + 1} must be a JSON object.`);
    const value = parsed as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id.trim()) throw new Error(`Benchmark line ${index + 1} is missing id.`);
    if (ids.has(value.id)) throw new Error(`Duplicate benchmark id: ${value.id}`);
    if (typeof value.question !== "string" || !value.question.trim()) throw new Error(`Benchmark ${value.id} is missing question.`);
    if (typeof value.answer !== "string" || !value.answer.trim()) throw new Error(`Benchmark ${value.id} is missing answer.`);
    if (typeof value.expectedPassed !== "boolean") throw new Error(`Benchmark ${value.id} is missing expectedPassed boolean.`);

    const labelSourceUrls = Array.isArray(value.labelSourceUrls)
      ? value.labelSourceUrls.filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url))
      : undefined;

    cases.push({
      id: value.id,
      question: value.question,
      answer: value.answer,
      expectedPassed: value.expectedPassed,
      ...(labelSourceUrls && labelSourceUrls.length > 0 ? { labelSourceUrls } : {}),
      ...(typeof value.note === "string" ? { note: value.note } : {}),
    });
    ids.add(value.id);
  }

  if (cases.length === 0) throw new Error("Benchmark dataset contains no cases.");
  return cases;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
