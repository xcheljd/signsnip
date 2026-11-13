/**
 * Brand cards save Name and Collections by themselves (on blur, and when the tab or the page is
 * left). This decides, without the DOM, whether what is in the two fields is worth a save.
 */

/** The Collections box: one per line; blank lines and spaces around a name don't count. */
export const parseCollections = (text: string): string[] => text.split("\n").map((s) => s.trim()).filter(Boolean);

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export interface BrandFields { name: string; collections: string[] }
export interface BrandSaveDecision {
  /** what to send (the whole name + collections, as they should be stored), or null: nothing changed */
  save: BrandFields | null;
  /** the name box is empty (or only spaces): the stored name stays, and the user is told */
  emptyName: boolean;
  /** which fields the save changes, for the quiet "Saved" note next to each */
  changed: ("name" | "collections")[];
}

/**
 * `stored` is what the brand has now (or what is already on its way to being saved);
 * `typed` is what the two fields hold. The store trims names, so spaces around a name are no
 * change; any other difference, capital letters included, is (saving by id may rename).
 * An empty name never saves; collections changed at the same time still do, under the stored name.
 */
export function brandSaveDecision(stored: BrandFields, typed: { name: string; collections: string }): BrandSaveDecision {
  const name = typed.name.trim();
  const emptyName = !name;
  const collections = parseCollections(typed.collections);
  const changed: BrandSaveDecision["changed"] = [];
  if (!emptyName && name !== stored.name.trim()) changed.push("name");
  if (!sameList(collections, stored.collections)) changed.push("collections");
  return {
    save: changed.length ? { name: changed.includes("name") ? name : stored.name, collections } : null,
    emptyName, changed,
  };
}
