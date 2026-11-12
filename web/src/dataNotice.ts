/**
 * The damaged-data notice: what to show, given what the app reports now and what this browser remembers.
 * DOM-free so tests can drive it; App.tsx keeps the memory in localStorage (`signsnip.dataProblems`).
 */

/** A stored part that couldn't be read, as /api/state (or the hosted backend) reports it. */
export type Problem = { key: string; keptAt?: string };
/** One part the notice lists. `kept` = a copy of the damaged file was kept (never in the hosted build). */
export type NoticePart = { key: string; kept: boolean };
/**
 * open: parts the notice lists until someone presses Close (they stay after the part reads fine again).
 * closed: parts closed while still damaged; they don't come back until they read fine and then break again.
 */
export type NoticeMemory = { open: NoticePart[]; closed: string[] };
export const NO_NOTICE: NoticeMemory = { open: [], closed: [] };

/** Fold the problems reported now into the memory: new parts join the open notice, healed parts leave `closed`. */
export function nextNotice(mem: NoticeMemory, problems: Problem[] = []): NoticeMemory {
  const now = new Set(problems.map((p) => p.key));
  const closed = mem.closed.filter((k) => now.has(k));
  const open = [...mem.open];
  for (const p of problems) {
    if (!closed.includes(p.key) && !open.some((o) => o.key === p.key)) open.push({ key: p.key, kept: !!p.keptAt });
  }
  return { open, closed };
}

/** Close pressed: nothing is listed, and every part it listed stays quiet while it is still damaged. */
export function closeNotice(mem: NoticeMemory): NoticeMemory {
  return { open: [], closed: [...new Set([...mem.closed, ...mem.open.map((p) => p.key)])] };
}

/** What a stored part is called in the notice, and whether it reads as "they" (brands) or "it" (the current batch). */
type PartName = { name: string; plural: boolean };
const PART_NAMES: Record<string, PartName> = {
  brands: { name: "brands", plural: true },
  batch: { name: "the current batch", plural: false },
  templates: { name: "templates", plural: true },
  presets: { name: "presets", plural: true },
  rules: { name: "text rules", plural: true },
};
const partName = (key: string): PartName =>
  key.startsWith("batches/") ? { name: `the saved batch “${key.slice("batches/".length)}”`, plural: false } : PART_NAMES[key] ?? { name: key, plural: false };
/** "a", "a and b", "a, b and c" */
const joinParts = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** One notice for every open part, or "" when there is nothing to show. */
export function noticeText(open: NoticePart[]): string {
  if (!open.length) return "";
  const parts = open.map((p) => partName(p.key));
  // "Your" replaces the first part's "the": "Your current batch", "Your saved batch “x”"
  const names = parts.map((p, i) => (i === 0 ? p.name.replace(/^the /, "") : p.name));
  const they = parts.length > 1 || parts[0]!.plural;
  // the hosted build can't keep a copy (keptAt is unset there), so it doesn't claim one
  const kept = !open.every((p) => p.kept) ? "" : open.length > 1 ? " Copies of the damaged files were kept." : " A copy of the damaged file was kept.";
  return `Your ${joinParts(names)} couldn't be opened, so ${they ? "they're" : "it's"} missing for now. Everything else is fine.${kept}`
    + ` If you have a backup from before this happened, Restore backup brings ${they ? "them" : "it"} back, but it replaces everything you have now.`;
}

/** Read the remembered notice; anything unreadable counts as nothing remembered. */
export function parseNoticeMemory(raw: string | null): NoticeMemory {
  try {
    const v = JSON.parse(raw ?? "null");
    const open = Array.isArray(v?.open) ? v.open.filter((p: unknown): p is NoticePart => typeof (p as NoticePart)?.key === "string").map((p: NoticePart) => ({ key: p.key, kept: !!p.kept })) : [];
    const closed = Array.isArray(v?.closed) ? v.closed.filter((k: unknown): k is string => typeof k === "string") : [];
    return { open, closed };
  } catch { return NO_NOTICE; }
}
