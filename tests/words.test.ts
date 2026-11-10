import { describe, expect, it } from "vitest";
import { count, pluralOf } from "../src/core/words";
import { describeSummary } from "../src/core/workspace";

describe("counts in words", () => {
  it("pluralises the nouns the app uses", () => {
    expect(pluralOf("batch")).toBe("batches");
    expect(pluralOf("saved batch")).toBe("saved batches");
    expect(pluralOf("box")).toBe("boxes");
    expect(pluralOf("copy")).toBe("copies");
    expect(pluralOf("sign")).toBe("signs");
    expect(count(1, "row")).toBe("1 row");
    expect(count(0, "row")).toBe("0 rows");
    expect(count(2, "person", "people")).toBe("2 people");
  });
  it("the restore dialog's summary of a backup", () => {
    expect(describeSummary({ brands: 1, logos: 0, templates: 5, presets: 1, saved: 0, signs: 1 }))
      .toBe("1 brand · 0 logos · 5 templates · 1 preset · 0 saved batches · 1 sign in the batch");
    expect(describeSummary({ brands: 2, logos: 1, templates: 1, presets: 0, saved: 1, signs: 23 }))
      .toBe("2 brands · 1 logo · 1 template · 0 presets · 1 saved batch · 23 signs in the batch");
  });
});
