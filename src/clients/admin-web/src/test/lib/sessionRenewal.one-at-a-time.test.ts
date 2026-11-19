// Rules: one renewal at a time (in this tab and across tabs), and a renewal that meets a sign-out.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush, restoreClock, setClock } from '../support/clock';
import { FakeServer, heldAnswer, ok } from '../support/server';
import {
  HOUR,
  MINUTE,
  NOON,
  SECOND,
  SESSION_KEY,
  at,
  keepSession,
  keptSession,
  renewedAt,
  sessionAt,
} from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const REFRESH = '/user/auth/refresh';

function load() {
  return import('@/lib/sessionRenewal');
}

/** The person signed in three hours ago and their access token ran out five seconds ago. */
function keepAnExpiredSession() {
  return keepSession(
    browser.store,
    sessionAt(NOON, { token: 'token-old', tokenLeftMs: -5 * SECOND, signedInAgoMs: 3 * HOUR }),
  );
}

beforeEach(() => {
  browser.store.wipe();
  server.reset();
  setClock(NOON);
});

afterEach(() => {
  browser.locks.otherTabIsDone();
  browser.setLocksAvailable(true);
  restoreClock();
});

describe('one renewal at a time', () => {
  it('two calls at once make one request', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    const held = heldAnswer();
    server.when('POST', REFRESH, () => held.answer);

    const first = renewSession();
    const second = renewSession();
    await flush();
    assert.equal(server.callsTo(REFRESH).length, 1, 'while the answer is awaited');

    held.give(ok(renewedAt(NOON, 'token-new')));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(server.callsTo(REFRESH).length, 1, 'after the answer');
    assert.equal(firstResult?.accessToken, 'token-new');
    assert.deepEqual(secondResult, firstResult);
  });

  it('two calls at once make one request in a browser that has no locks, too', async () => {
    // An old browser, or a page on plain http: nothing but this tab itself keeps the calls apart.
    browser.setLocksAvailable(false);
    const { renewSession } = await load();
    keepAnExpiredSession();
    const held = heldAnswer();
    server.when('POST', REFRESH, () => held.answer);

    const first = renewSession();
    const second = renewSession();
    await flush();
    assert.equal(server.callsTo(REFRESH).length, 1, 'while the answer is awaited');

    held.give(ok(renewedAt(NOON, 'token-new')));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(server.callsTo(REFRESH).length, 1, 'after the answer');
    assert.equal(firstResult?.accessToken, 'token-new');
    assert.deepEqual(secondResult, firstResult);
    assert.equal(keptSession(browser.store)?.accessToken, 'token-new');
  });

  it('with no stored session there is no request and the result is null', async () => {
    const { renewSession } = await load();
    server.when('POST', REFRESH, ok(renewedAt(NOON, 'token-for-nobody')));

    assert.equal(await renewSession(), null);

    assert.deepEqual(server.log(), []);
    assert.equal(browser.store.peek(SESSION_KEY), null);
  });

  it('when another tab has already renewed, there is no request and that session is returned', async () => {
    const { renewSession } = await load();
    const mine = keepAnExpiredSession();
    server.when('POST', REFRESH, ok(renewedAt(NOON, 'token-this-tab-must-not-ask-for')));

    // Another tab holds the browser lock: this tab waits its turn.
    browser.locks.otherTabHoldsTheLock();
    const renewing = renewSession();
    await flush();
    assert.deepEqual(server.log(), [], 'nothing is sent while this tab waits its turn');

    // The other tab finishes its renewal: the store now holds the session it got.
    const fromTheOtherTab = keepSession(browser.store, {
      ...mine,
      accessToken: 'token-from-the-other-tab',
      expiresAtUtc: at(NOON + 15 * MINUTE),
    });
    browser.locks.otherTabIsDone();

    assert.deepEqual(await renewing, fromTheOtherTab);
    assert.deepEqual(server.log(), [], 'and nothing is sent afterwards either');
    assert.deepEqual(keptSession(browser.store), fromTheOtherTab);
  });
});

describe('a sign-out while the renewal call is in the air', () => {
  it('stopRenewal(): gives null and nothing is stored', async () => {
    const { renewSession, stopRenewal } = await load();
    keepAnExpiredSession();
    const storedBefore = browser.store.peek(SESSION_KEY);
    const held = heldAnswer();
    server.when('POST', REFRESH, () => held.answer);

    const renewing = renewSession();
    await flush();
    assert.equal(server.callsTo(REFRESH).length, 1, 'the call is in the air');

    stopRenewal();
    // The server's answer arrives all the same, a moment too late.
    held.give(ok(renewedAt(NOON, 'token-that-came-too-late')));

    assert.equal(await renewing, null);
    await flush();
    assert.ok(!browser.store.everything().includes('token-that-came-too-late'));
    assert.equal(browser.store.peek(SESSION_KEY), storedBefore);
  });

  it('the store cleared before the answer arrives: gives null and nothing is stored', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    const held = heldAnswer();
    server.when('POST', REFRESH, () => held.answer);

    const renewing = renewSession();
    await flush();
    assert.equal(server.callsTo(REFRESH).length, 1, 'the call is in the air');

    browser.store.drop(SESSION_KEY); // signed out, in this tab or in another
    held.give(ok(renewedAt(NOON, 'token-that-came-too-late')));

    assert.equal(await renewing, null);
    await flush();
    assert.equal(browser.store.peek(SESSION_KEY), null, 'a renewal never brings a session back');
    assert.ok(!browser.store.everything().includes('token-that-came-too-late'));
  });
});
