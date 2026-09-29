export function renderReceiptHelp(): string {
  return [
    "ClaimLatch signed verification receipt tool",
    "",
    "Usage:",
    "  claimlatch-receipt verify --file <path> [--json]",
    "",
    "Commands:",
    "  verify                            Verify the receipt signature",
    "",
    "Options:",
    "  --file <path>                     Signed receipt JSON file",
    "  --json                            Print machine-readable output",
    "  -h, --help                        Show this help",
    "",
    "Exit codes:",
    "  0  Receipt signature is valid",
    "  1  Receipt is invalid or signature verification failed",
    "  2  Usage or file error",
    "",
  ].join("\n");
}
