// spec: plr-d10-redesign-real-integration-2026-10-25 (I25) — the one-time notice sheet must
// never hold a farmer on a stalled network or a wedged phone database. Every wait it does is
// bounded by this.

/** Resolves with `work`, or rejects once `ms` have passed — whichever comes first. */
export function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
        work.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error: unknown) => { clearTimeout(timer); reject(error); },
        );
    });
}
