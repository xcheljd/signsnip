/**
 * What a preview PDF was made from. usePdf renders for this key, and Print compares it with the
 * key of the batch as it is at the click: a preview made for anything else is never printed.
 */
export const pdfKey = (items: unknown, options: unknown, mode: "sheet" | "single", version = ""): string =>
  JSON.stringify([items, options, mode, version]);

/** The preview PDF when it was made for exactly `wanted`, else null (the caller renders a fresh one). */
export function reusablePdf<T>(preview: { pdf: T | null; madeFor: string | null }, wanted: string): T | null {
  return preview.pdf !== null && preview.madeFor === wanted ? preview.pdf : null;
}
