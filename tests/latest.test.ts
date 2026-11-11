import { describe, expect, it } from "vitest";
import { latestOnly } from "../web/src/latest";

/** A promise we settle by hand, so the test controls the finishing order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("latestOnly", () => {
  it("delivers only the newest job when an older one finishes later", async () => {
    const l = latestOnly<string>();
    const values: string[] = [];
    const errors: Error[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    l.run(() => first.promise, (v) => values.push(v), (e) => errors.push(e));
    l.run(() => second.promise, (v) => values.push(v), (e) => errors.push(e));
    second.resolve("new");
    await flush();
    first.resolve("old");
    await flush();
    expect(values).toEqual(["new"]);
    expect(errors).toEqual([]);
  });

  it("delivers nothing after cancel()", async () => {
    const l = latestOnly<string>();
    const values: string[] = [];
    const job = deferred<string>();
    l.run(() => job.promise, (v) => values.push(v), () => values.push("error"));
    l.cancel();
    job.resolve("late");
    await flush();
    expect(values).toEqual([]);
  });

  it("ignores a late rejection from an older job", async () => {
    const l = latestOnly<string>();
    const values: string[] = [];
    const errors: Error[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    l.run(() => first.promise, (v) => values.push(v), (e) => errors.push(e));
    l.run(() => second.promise, (v) => values.push(v), (e) => errors.push(e));
    second.resolve("new");
    await flush();
    first.reject(new Error("old render failed"));
    await flush();
    expect(values).toEqual(["new"]);
    expect(errors).toEqual([]);
  });
});
