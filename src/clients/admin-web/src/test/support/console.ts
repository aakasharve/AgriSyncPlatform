/**
 * Loads the console's request layer for a test, the way a page load does, and puts the pretend
 * server under its HTTP client.
 *
 * Call it inside a test, AFTER the pretend browser and the pretend server are in place: the
 * modules read `globalThis` and make their HTTP client as they load.
 */

import type { FakeServer } from './server';

export async function loadConsole(server: FakeServer) {
  const api = await import('@/lib/api');
  const { queryClient } = await import('@/lib/queryClient');
  server.attach(api.adminApi);
  return { api, queryClient };
}
