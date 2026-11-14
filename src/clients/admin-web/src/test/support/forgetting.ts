/**
 * For the rule "every end of a session calls the `onSessionForgotten` listener and empties the
 * shared data cache": puts a listener in place and something in the cache, and says afterwards
 * whether the listener was called and whether the cache still holds it.
 */

import type { QueryClient } from '@tanstack/react-query';

const LOADED_FOR_THE_PERSON = ['loaded-for-the-signed-in-person'];

export interface Forgetting {
  /** How many times the listener has been called. */
  listenerCalls(): number;
  /** True while the cache still holds what was put in it. */
  cacheStillHolds(): boolean;
}

export function watchForgetting(
  onSessionForgotten: (listener: () => void) => unknown,
  queryClient: QueryClient,
): Forgetting {
  let calls = 0;
  onSessionForgotten(() => {
    calls += 1;
  });
  // Never aged out by the cache itself, so only an emptying can make it go (and no timer of the
  // cache's own is left running when the test ends).
  queryClient.setQueryDefaults(LOADED_FOR_THE_PERSON, { gcTime: Infinity });
  queryClient.setQueryData(LOADED_FOR_THE_PERSON, { names: ['somebody the person looked at'] });
  if (queryClient.getQueryData(LOADED_FOR_THE_PERSON) === undefined) {
    // Without this, "the cache is empty afterwards" would prove nothing.
    throw new Error('The cache did not keep what the test put in it.');
  }
  return {
    listenerCalls: () => calls,
    cacheStillHolds: () => queryClient.getQueryData(LOADED_FOR_THE_PERSON) !== undefined,
  };
}
