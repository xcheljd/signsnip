import { describe, expect, it } from "vitest";
import { NO_NOTICE, closeNotice, nextNotice, noticeText, parseNoticeMemory, type NoticeMemory, type Problem } from "../web/src/dataNotice";

const batch: Problem = { key: "batch", keptAt: "/data/damaged/batch-1.json" };
const brands: Problem = { key: "brands", keptAt: "/data/damaged/brands-1.json" };
const presets: Problem = { key: "presets", keptAt: "/data/damaged/presets-1.json" };
const rules: Problem = { key: "rules", keptAt: "/data/damaged/rules-1.json" };
const clearance: Problem = { key: "batches/clearance-wall", keptAt: "/data/damaged/batches-clearance-wall-1.json" };
/** Run a sequence of polls (each one the problems reported then) from a starting memory. */
const polls = (start: NoticeMemory, ...each: Problem[][]) => each.reduce((m, p) => nextNotice(m, p), start);
const shown = (m: NoticeMemory) => noticeText(m.open);
/** The same parts as the hosted build reports them: it can't keep a copy, so there is no keptAt. */
const hosted = (...ps: Problem[]) => ps.map((p) => ({ key: p.key }));
const BACK_IT = "If you have a backup from before this happened, Restore backup brings it back, but it replaces everything you have now.";
const BACK_THEM = "If you have a backup from before this happened, Restore backup brings them back, but it replaces everything you have now.";

describe("damaged-data notice wording", () => {
  it("one part read as 'it': Your current batch (no 'the' after 'Your')", () => {
    expect(shown(polls(NO_NOTICE, [batch]))).toBe(
      `Your current batch couldn't be opened, so it's missing for now. Everything else is fine. A copy of the damaged file was kept. ${BACK_IT}`,
    );
  });

  it("one part read as 'they': brands, presets, templates, text rules (one file, so one copy)", () => {
    expect(shown(polls(NO_NOTICE, [brands]))).toBe(
      `Your brands couldn't be opened, so they're missing for now. Everything else is fine. A copy of the damaged file was kept. ${BACK_THEM}`,
    );
    expect(shown(polls(NO_NOTICE, [rules]))).toBe(
      `Your text rules couldn't be opened, so they're missing for now. Everything else is fine. A copy of the damaged file was kept. ${BACK_THEM}`,
    );
    expect(shown(polls(NO_NOTICE, [presets]))).toMatch(/^Your presets couldn't be opened, so they're missing for now\./);
    expect(shown(polls(NO_NOTICE, [{ key: "templates", keptAt: "/data/damaged/templates-1.json" }]))).toMatch(/^Your templates couldn't be opened, so they're missing for now\./);
  });

  it("one saved batch: Your saved batch “x” … it's, name in quotes", () => {
    expect(shown(polls(NO_NOTICE, [clearance]))).toBe(
      `Your saved batch “clearance-wall” couldn't be opened, so it's missing for now. Everything else is fine. A copy of the damaged file was kept. ${BACK_IT}`,
    );
    expect(shown(polls(NO_NOTICE, [{ key: "batches/Spring sale" }]))).toMatch(/^Your saved batch “Spring sale” couldn't be opened, so it's/);
  });

  it("two parts: joined with 'and', read as 'they', copies (plural) kept; only the first loses its 'the'", () => {
    expect(shown(polls(NO_NOTICE, [presets, clearance]))).toBe(
      `Your presets and the saved batch “clearance-wall” couldn't be opened, so they're missing for now. Everything else is fine. Copies of the damaged files were kept. ${BACK_THEM}`,
    );
    // two parts that are each an "it" are still "they" together
    expect(shown(polls(NO_NOTICE, [batch, clearance]))).toBe(
      `Your current batch and the saved batch “clearance-wall” couldn't be opened, so they're missing for now. Everything else is fine. Copies of the damaged files were kept. ${BACK_THEM}`,
    );
  });

  it("three parts: commas and a final 'and', in the order they were found", () => {
    expect(shown(polls(NO_NOTICE, [presets], [clearance], [rules]))).toBe(
      `Your presets, the saved batch “clearance-wall” and text rules couldn't be opened, so they're missing for now. Everything else is fine. Copies of the damaged files were kept. ${BACK_THEM}`,
    );
    expect(shown(polls(NO_NOTICE, [batch, brands, clearance]))).toMatch(/^Your current batch, brands and the saved batch “clearance-wall” couldn't be opened, so they're/);
  });

  it("hosted build (no copy kept): the same without the copy sentence, for 1, 2 and 3 parts", () => {
    expect(shown(polls(NO_NOTICE, hosted(batch)))).toBe(`Your current batch couldn't be opened, so it's missing for now. Everything else is fine. ${BACK_IT}`);
    expect(shown(polls(NO_NOTICE, hosted(presets)))).toBe(`Your presets couldn't be opened, so they're missing for now. Everything else is fine. ${BACK_THEM}`);
    expect(shown(polls(NO_NOTICE, hosted(presets, clearance)))).toBe(
      `Your presets and the saved batch “clearance-wall” couldn't be opened, so they're missing for now. Everything else is fine. ${BACK_THEM}`,
    );
    expect(shown(polls(NO_NOTICE, hosted(presets, clearance, rules)))).toBe(
      `Your presets, the saved batch “clearance-wall” and text rules couldn't be opened, so they're missing for now. Everything else is fine. ${BACK_THEM}`,
    );
  });
});

describe("damaged-data notice behaviour", () => {
  it("stays after the part reads fine again (saved over), until Close", () => {
    const m = polls(NO_NOTICE, [batch], [], [], []);
    expect(shown(m)).toMatch(/^Your current batch couldn't be opened/);
    expect(shown(closeNotice(m))).toBe("");
  });

  it("lists every part not yet closed, in one notice", () => {
    const m = polls(NO_NOTICE, [batch], [], [brands]);
    expect(shown(m)).toMatch(/^Your current batch and brands couldn't be opened/);
    expect(m.open).toHaveLength(2);
    // the same part reported again does not list it twice
    expect(polls(m, [batch, brands]).open).toHaveLength(2);
  });

  it("a closed part that is still damaged does not come back on the next polls", () => {
    const closed = closeNotice(polls(NO_NOTICE, [brands]));
    expect(shown(polls(closed, [brands], [brands], [brands]))).toBe("");
  });

  it("a closed part comes back when it breaks again after reading fine", () => {
    const closed = closeNotice(polls(NO_NOTICE, [brands]));
    expect(shown(polls(closed, [brands], [], [brands]))).toMatch(/^Your brands couldn't be opened/);
  });

  it("a different part shows after Close, without the closed one", () => {
    const closed = closeNotice(polls(NO_NOTICE, [brands]));
    expect(shown(polls(closed, [brands, batch]))).toMatch(/^Your current batch couldn't be opened, so it's missing/);
  });

  it("survives a reload: the remembered memory round-trips through localStorage text", () => {
    const m = closeNotice(polls(NO_NOTICE, [brands]));
    const open = polls(m, [brands, batch]);
    expect(parseNoticeMemory(JSON.stringify(open))).toEqual(open);
    // after a reload the healthy app still shows the remembered notice
    expect(shown(polls(parseNoticeMemory(JSON.stringify(open)), []))).toMatch(/^Your current batch couldn't be opened/);
  });

  it("unreadable or missing memory counts as nothing remembered", () => {
    for (const raw of [null, "", "{ not json", "42", '{"open":[{"nokey":1}],"closed":[3]}']) expect(parseNoticeMemory(raw)).toEqual(NO_NOTICE);
  });
});
