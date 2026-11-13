import { count } from "../../src/core/words";
import type { Warning } from "../../src/core/types";
import { warningActions, type WarningAction } from "./rowWarnings";

/**
 * The one "N things to check before printing" panel above the batch: which checks it lists, under
 * which short heading, in which order, and how many show before "Show all". Pure, so it is tested
 * without a browser (tests/warning-panel.test.ts).
 *
 * It lists what the batch card listed before the panel existed, no more: every real warning
 * (level "warn") and the notes about auto-fit and tight fits. Other notes (a logo on a white
 * background) still show nowhere, as before.
 */

export type WarningGroupId = "logos" | "text" | "prices" | "templates" | "other" | "auto-fit" | "tight";

/** Short headings; the two note groups keep the titles their boxes had before the panel. */
export const GROUP_TITLE: Record<WarningGroupId, string> = {
  logos: "Logos",
  text: "Text too small",
  prices: "Prices",
  templates: "Templates",
  other: "Other",
  "auto-fit": "Auto-fit kept the text readable",
  tight: "Tight fits that still print fine",
};

/** Warning groups first, notes last. */
const ORDER: WarningGroupId[] = ["logos", "text", "prices", "templates", "other", "auto-fit", "tight"];

/** How many lines the panel shows before "Show all N". */
export const PANEL_LIMIT = 5;

export interface PanelLine {
  message: string;
  /** "info" = a note: drawn quieter, listed after every warning */
  level: Warning["level"];
  /** the row the line's buttons act on (its first row) */
  row: number;
  brandId: string;
  actions: WarningAction[];
}
export interface PanelGroup { id: WarningGroupId; title: string; lines: PanelLine[] }

const NOTE_CODES = new Set<Warning["code"]>(["auto-abbrev", "auto-template", "spill"]);

/** Does the panel list this check at all? */
export const listed = (w: Warning) => w.level === "warn" || NOTE_CODES.has(w.code);

export function groupOf(w: Warning): WarningGroupId {
  if (w.level === "info") return w.code === "spill" ? "tight" : "auto-fit";
  switch (w.code) {
    case "no-logo": case "low-res-logo": case "logo-background": return "logos";
    case "small-text": case "spill": return "text";
    case "was-price": return "prices";
    case "kind-mismatch": return "templates";
    default: return "other";
  }
}

/**
 * The same buttons as before the panel: a warning gets what its row triangle offers
 * (warningActions); a tight-fit note gets "See it in the designer" for its own row.
 */
export function lineActions(w: Warning, brandExists: boolean): WarningAction[] {
  if (w.level === "info") return w.code === "spill" ? ["open-designer"] : [];
  return warningActions(w, brandExists);
}

/** The listed checks as headed groups: warnings first (Logos, Text too small, Prices, Templates, Other), then notes; checks keep their order inside a group. */
export function panelGroups(warnings: Warning[], brandIds: Iterable<string>): PanelGroup[] {
  const known = new Set(brandIds);
  const by = new Map<WarningGroupId, PanelLine[]>();
  for (const w of warnings) {
    if (!listed(w)) continue;
    const g = groupOf(w);
    by.set(g, [...(by.get(g) ?? []), { message: w.message, level: w.level, row: w.items[0] ?? 0, brandId: w.brandId, actions: lineActions(w, known.has(w.brandId)) }]);
  }
  return ORDER.filter((id) => by.has(id)).map((id) => ({ id, title: GROUP_TITLE[id], lines: by.get(id)! }));
}

export const lineCount = (groups: PanelGroup[]) => groups.reduce((n, g) => n + g.lines.length, 0);

/** "1 thing to check before printing", "9 things to check before printing" */
export const panelTitle = (lines: number) => `${count(lines, "thing")} to check before printing`;

/**
 * What the panel shows: everything when it has at most PANEL_LIMIT lines or is expanded;
 * otherwise the first PANEL_LIMIT lines (headings of groups left empty drop out).
 */
export function visibleGroups(groups: PanelGroup[], expanded: boolean, limit = PANEL_LIMIT): PanelGroup[] {
  if (expanded || lineCount(groups) <= limit) return groups;
  const out: PanelGroup[] = [];
  let left = limit;
  for (const g of groups) {
    if (left <= 0) break;
    out.push({ ...g, lines: g.lines.slice(0, left) });
    left -= g.lines.length;
  }
  return out;
}
