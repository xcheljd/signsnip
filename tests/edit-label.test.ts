import { describe, expect, it } from "vitest";
import type { Sign } from "../src/core/types";
import { editLabel } from "../web/src/editLabel";

const sign = (id: string, brandId: string, collection: string): Sign => ({
  id, brandId, kind: "percent", templateId: "percent", prefix: "SELECT", collection, percent: 50, offLabel: "OFF*", priceLabel: "", footer: "*MSRP", copies: 1,
});
const brands = [{ id: "northwind", name: "Northwind Watch Co." }, { id: "kestrel-vale", name: "Kestrel & Vale" }];
const items = [sign("a", "northwind", "Harbor Line"), sign("b", "northwind", "Deckhand"), sign("c", "kestrel-vale", "Falcon")];

describe("editLabel (sign card title and print bar while editing)", () => {
  it("names the row number, the brand's name and the collection", () => {
    expect(editLabel(items, "c", brands)).toBe("Editing row 3 · Kestrel & Vale Falcon");
    expect(editLabel(items, "a", brands)).toBe("Editing row 1 · Northwind Watch Co. Harbor Line");
  });

  it("is null when nothing is being edited or the row is gone", () => {
    expect(editLabel(items, null, brands)).toBeNull();
    expect(editLabel(items, "removed-row", brands)).toBeNull();
  });

  it("shows the id of a brand that was deleted, like the batch table", () => {
    expect(editLabel([sign("x", "retired-brand", "Old Stock")], "x", brands)).toBe("Editing row 1 · retired-brand Old Stock");
  });

  it("drops an empty collection and squeezes stray spaces", () => {
    expect(editLabel([sign("x", "northwind", "")], "x", brands)).toBe("Editing row 1 · Northwind Watch Co.");
    expect(editLabel([sign("x", "northwind", "  Seabird   Chrono ")], "x", brands)).toBe("Editing row 1 · Northwind Watch Co. Seabird Chrono");
  });

  it("names the row as saved, so the label follows the row when rows move", () => {
    const moved = [items[2]!, items[0]!, items[1]!];
    expect(editLabel(moved, "c", brands)).toBe("Editing row 1 · Kestrel & Vale Falcon");
  });
});
