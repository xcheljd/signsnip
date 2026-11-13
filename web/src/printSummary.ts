import { sheetGeometry } from "../../src/core/geometry";
import type { Batch } from "../../src/core/types";

/**
 * The one line the closed "Print settings" shows on the Print sheet card, e.g.
 * "Letter · 10 per page · cut lines off". Tested in tests/print-summary.test.ts.
 */
export function printSummary(options: Batch["options"]): string {
  const paper = options.paper === "a4" ? "A4" : "Letter";
  return `${paper} · ${sheetGeometry(options).perPage} per page · cut lines ${options.cutMarks ? "on" : "off"}`;
}

/** localStorage key: whether "Print settings" was left open (closed by default) */
export const PRINT_SETTINGS_KEY = "signsnip.printSettingsOpen";
