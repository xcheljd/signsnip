/**
 * When a backup was made, to the minute ("Nov 12, 2026, 3:04 PM"): the restore dialog's line.
 * Seconds don't help anyone pick a file. Something that isn't a date is shown as it is.
 * `locale` / `timeZone` are for tests; the app uses the browser's. Tested in tests/backup-time.test.ts.
 */
export function backupTime(exportedAt: string, opts: { locale?: string; timeZone?: string } = {}): string {
  const d = new Date(exportedAt);
  if (Number.isNaN(d.getTime())) return exportedAt;
  return d.toLocaleString(opts.locale, { dateStyle: "medium", timeStyle: "short", timeZone: opts.timeZone });
}
