/** Run async jobs where only the most recently started one may deliver its result. */
export function latestOnly<T>() {
  let gen = 0;
  return {
    run(job: () => Promise<T>, onValue: (v: T) => void, onError: (e: Error) => void) {
      const mine = ++gen;
      job().then((v) => { if (mine === gen) onValue(v); }, (e) => { if (mine === gen) onError(e as Error); });
    },
    cancel() { gen++; },
  };
}
