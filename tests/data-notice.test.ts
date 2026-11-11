import { describe, expect, it } from "vitest";
import { NO_NOTICE, closeNotice, nextNotice, noticeText, parseNoticeMemory, type NoticeMemory, type Problem } from "../web/src/dataNotice";

const batch: Problem = { key: "batch", keptAt: "/data/damaged/batch-1.json" };
const brands: Problem = { key: "brands", keptAt: "/data/damaged/brands-1.json" };
/** Run a sequence of polls (each one the problems reported then) from a starting memory. */
const polls = (start: NoticeMemory, ...each: Problem[][]) => each.reduce((m, p) => nextNotice(m, p), start);
const shown = (m: NoticeMemory) => noticeText(m.open);

describe("damaged-data notice", () => {
  it("shows the approved wording for one damaged part", () => {
    expect(shown(polls(NO_NOTICE, [batch]))).toBe(
      "Part of your saved data couldn't be read (the current batch). SignSnip started without it and kept a copy of the damaged file. Restore a backup to get it back.",
    );
  });

  it("stays after the part reads fine again (saved over), until Close", () => {
    const m = polls(NO_NOTICE, [batch], [], [], []);
    expect(shown(m)).toContain("(the current batch)");
    expect(shown(closeNotice(m))).toBe("");
  });

  it("lists every part not yet closed, in one notice", () => {
    const m = polls(NO_NOTICE, [batch], [], [brands]);
    expect(shown(m)).toBe(
      "Part of your saved data couldn't be read (the current batch, brands). SignSnip started without it and kept copies of the damaged files. Restore a backup to get it back.",
    );
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
    expect(shown(polls(closed, [brands], [], [brands]))).toContain("(brands)");
  });

  it("a different part shows after Close, without the closed one", () => {
    const closed = closeNotice(polls(NO_NOTICE, [brands]));
    expect(shown(polls(closed, [brands, batch]))).toContain("couldn't be read (the current batch).");
  });

  it("hosted wording: no copy kept, so no copy sentence", () => {
    expect(shown(polls(NO_NOTICE, [{ key: "templates" }]))).toBe(
      "Part of your saved data couldn't be read (templates). SignSnip started without it. Restore a backup to get it back.",
    );
    // a saved batch name keeps its quotes
    expect(shown(polls(NO_NOTICE, [{ key: "batches/Spring sale" }]))).toContain("(the saved batch “Spring sale”)");
  });

  it("survives a reload: the remembered memory round-trips through localStorage text", () => {
    const m = closeNotice(polls(NO_NOTICE, [brands]));
    const open = polls(m, [brands, batch]);
    expect(parseNoticeMemory(JSON.stringify(open))).toEqual(open);
    // after a reload the healthy app still shows the remembered notice
    expect(shown(polls(parseNoticeMemory(JSON.stringify(open)), []))).toContain("(the current batch)");
  });

  it("unreadable or missing memory counts as nothing remembered", () => {
    for (const raw of [null, "", "{ not json", "42", '{"open":[{"nokey":1}],"closed":[3]}']) expect(parseNoticeMemory(raw)).toEqual(NO_NOTICE);
  });
});
