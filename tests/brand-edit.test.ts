import { describe, expect, it } from "vitest";
import { brandSaveDecision, parseCollections } from "../web/src/brandEdit";

const stored = { name: "Northwind", collections: ["Harbor", "Tidal"] };

describe("does a brand card field save on blur / when leaving?", () => {
  it("nothing changed: no save", () => {
    expect(brandSaveDecision(stored, { name: "Northwind", collections: "Harbor\nTidal" })).toEqual({ save: null, emptyName: false, changed: [] });
  });
  it("spaces around the name and blank lines between collections are no change (the store trims them)", () => {
    expect(brandSaveDecision(stored, { name: "  Northwind ", collections: "\n Harbor \n\nTidal\n" }).save).toBeNull();
  });
  it("a new collection saves, with the stored name", () => {
    const d = brandSaveDecision(stored, { name: "Northwind", collections: "Harbor\nTidal\nReef" });
    expect(d.save).toEqual({ name: "Northwind", collections: ["Harbor", "Tidal", "Reef"] });
    expect(d.changed).toEqual(["collections"]);
  });
  it("reordering collections is a change (the order is the suggestion order)", () => {
    expect(brandSaveDecision(stored, { name: "Northwind", collections: "Tidal\nHarbor" }).changed).toEqual(["collections"]);
  });
  it("a renamed brand saves the trimmed name; a change of capitals counts", () => {
    expect(brandSaveDecision(stored, { name: " Northwind Co ", collections: "Harbor\nTidal" }).save).toEqual({ name: "Northwind Co", collections: ["Harbor", "Tidal"] });
    expect(brandSaveDecision(stored, { name: "NORTHWIND", collections: "Harbor\nTidal" }).changed).toEqual(["name"]);
  });
  it("an empty or spaces-only name never saves", () => {
    for (const name of ["", "   "]) {
      const d = brandSaveDecision(stored, { name, collections: "Harbor\nTidal" });
      expect(d).toEqual({ save: null, emptyName: true, changed: [] });
    }
  });
  it("an empty name next to changed collections: the collections save under the stored name", () => {
    const d = brandSaveDecision(stored, { name: " ", collections: "Harbor" });
    expect(d.emptyName).toBe(true);
    expect(d.save).toEqual({ name: "Northwind", collections: ["Harbor"] });
    expect(d.changed).toEqual(["collections"]);
  });
  it("parseCollections drops blanks and trims", () => {
    expect(parseCollections(" A \n\n B\n")).toEqual(["A", "B"]);
    expect(parseCollections("")).toEqual([]);
  });
});
