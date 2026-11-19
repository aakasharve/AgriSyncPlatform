// Rule: a token obtained under a minute ago is never renewed ahead of time, even when it looks
// about to expire. Here the token was obtained by a renewal. That is remembered for the life of
// the page, so this scenario has a file (a page load) to itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { FakeServer, ok } from '../support/server';
import {
  HOUR,
  MINUTE,
  NOON,
  PERSON,
  SECOND,
  at,
  keepSession,
  sessionAt,
  type StoredSession,
} from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

describe('a token that a renewal has just brought, and that already looks about to expire', () => {
  let renewed: StoredSession | null = null;
  let needsRenewal: (session: StoredSession, nowMs?: number) => boolean;

  before(async () => {
    const { accessTokenNeedsRenewal, renewSession } = await import('@/lib/sessionRenewal');
    needsRenewal = accessTokenNeedsRenewal;

    setClock(NOON);
    keepSession(
      browser.store,
      sessionAt(NOON, { token: 'token-old', tokenLeftMs: -5 * SECOND, signedInAgoMs: 3 * HOUR }),
    );
    // This computer's clock runs ahead of the server's: the new token seems to have 20 seconds.
    server.when(
      'POST',
      '/user/auth/refresh',
      ok({ userId: PERSON, accessToken: 'token-new', expiresAtUtc: at(NOON + 20 * SECOND) }),
    );
    renewed = await renewSession();
  });

  after(() => {
    restoreClock();
  });

  it('was renewed', () => {
    assert.equal(renewed?.accessToken, 'token-new');
    assert.equal(renewed?.signedInAtUtc, at(NOON - 3 * HOUR), 'signed in hours ago');
  });

  it('is not renewed again in the first minute after it was obtained', () => {
    assert.ok(renewed);
    assert.equal(needsRenewal(renewed, NOON), false);
    assert.equal(needsRenewal(renewed, NOON + 30 * SECOND), false);
    assert.equal(needsRenewal(renewed, NOON + MINUTE - 1), false);
  });

  it('reads the clock itself when no time is passed in', () => {
    assert.ok(renewed);
    setClock(NOON + 30 * SECOND);
    assert.equal(needsRenewal(renewed), false);
  });

  it('is renewed once a minute has passed since it was obtained', () => {
    assert.ok(renewed);
    assert.equal(needsRenewal(renewed, NOON + MINUTE), true);
    assert.equal(needsRenewal(renewed, NOON + 5 * MINUTE), true);
  });
});
