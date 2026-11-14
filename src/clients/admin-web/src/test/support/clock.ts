/**
 * Time for the tests. Nothing ever waits on the real clock: a test sets the time it wants and
 * moves it by hand.
 */

import { mock } from 'node:test';

// Kept from before any test swaps the timers, so `flush` always works.
const realSetImmediate = setImmediate;

/**
 * Lets everything that is already on its way finish: every promise that can settle without the
 * clock moving does so. No time passes.
 */
export function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    realSetImmediate(resolve);
  });
}

/** Makes `Date` say it is `nowMs`. Timers are left alone. Undo with `restoreClock`. */
export function setClock(nowMs: number): void {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: nowMs });
}

/** Gives back the real clock and the real timers. */
export function restoreClock(): void {
  mock.timers.reset();
}

type LooseTimerCall = (...args: unknown[]) => unknown;

export interface FakeTime {
  /** Lets this much time pass, running the timers that fall due, then lets their work finish. */
  pass(ms: number): Promise<void>;
  /** Lets time pass in steps, letting work finish after each one. */
  passInSteps(totalMs: number, stepMs: number): Promise<void>;
  /** The clock jumps to this moment and no timer runs: a computer waking from sleep. */
  jumpTo(nowMs: number): void;
  /** How many timers are set and have neither run nor been taken away. */
  timersWaiting(): number;
}

/**
 * Makes `Date` say it is `nowMs` and puts `setTimeout` / `clearTimeout` under the test's hand.
 * Undo with `restoreClock`.
 *
 * On top of Node's own pretend timers sits a small ledger, for two reasons: so that a test can
 * ask whether any timer is still waiting, and so that `clearTimeout(undefined)`, which a browser
 * ignores, is ignored here too on every version of Node.
 */
export function fakeTime(nowMs: number): FakeTime {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: nowMs });

  const pretendSet = globalThis.setTimeout as unknown as LooseTimerCall;
  const pretendClear = globalThis.clearTimeout as unknown as LooseTimerCall;
  const waiting = new Set<unknown>();

  const set: LooseTimerCall = (callback, ms, ...args) => {
    const id: unknown = pretendSet(() => {
      waiting.delete(id);
      (callback as LooseTimerCall)(...args);
    }, ms);
    waiting.add(id);
    return id;
  };
  const clear: LooseTimerCall = (id) => {
    if (id === undefined || id === null) return undefined;
    waiting.delete(id);
    return pretendClear(id);
  };
  globalThis.setTimeout = set as unknown as typeof setTimeout;
  globalThis.clearTimeout = clear as unknown as typeof clearTimeout;

  async function pass(ms: number): Promise<void> {
    mock.timers.tick(ms);
    await flush();
  }

  return {
    pass,
    async passInSteps(totalMs: number, stepMs: number): Promise<void> {
      for (let passed = 0; passed < totalMs; passed += stepMs) {
        await pass(Math.min(stepMs, totalMs - passed));
      }
    },
    jumpTo(newNowMs: number): void {
      mock.timers.setTime(newNowMs);
    },
    timersWaiting: () => waiting.size,
  };
}
