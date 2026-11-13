import { describe, expect, it } from "vitest";
import { backupTime } from "../web/src/backupTime";

describe("backup time in the restore dialog", () => {
  const opts = { locale: "en-US", timeZone: "UTC" };

  it("shows the date and the time to the minute, without seconds", () => {
    expect(backupTime("2026-11-12T15:04:37.512Z", opts)).toBe("Nov 12, 2026, 3:04 PM");
  });

  it("never shows seconds, also at the end of a minute", () => {
    const s = backupTime("2026-01-02T09:59:59.999Z", opts);
    expect(s).toBe("Jan 2, 2026, 9:59 AM");
    expect(s).not.toMatch(/:\d\d:\d\d/);
  });

  it("something that isn't a date is shown as it is", () => {
    expect(backupTime("yesterday", opts)).toBe("yesterday");
  });
});
