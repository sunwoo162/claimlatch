export type BenchmarkSplit = "train" | "dev" | "test";

export function parseBenchmarkSplit(value: string): BenchmarkSplit {
  if (value === "train" || value === "dev" || value === "test") return value;
  throw new Error(`Unsupported benchmark split: ${value}. Use train, dev, or test.`);
}

export function resolveBenchmarkDatasetPath(split: BenchmarkSplit): URL {
  return new URL(`../../benchmarks/${split}.jsonl`, import.meta.url);
}

export function resolveBenchmarkDatasetSelection(
  datasetArgument: string | undefined,
  splitArgument: string | undefined,
): string | URL {
  if (datasetArgument && splitArgument) {
    throw new Error("--split cannot be combined with --dataset.");
  }
  if (datasetArgument) return datasetArgument;
  if (splitArgument) return resolveBenchmarkDatasetPath(parseBenchmarkSplit(splitArgument));
  return new URL("../../benchmarks/independent.jsonl", import.meta.url);
}
