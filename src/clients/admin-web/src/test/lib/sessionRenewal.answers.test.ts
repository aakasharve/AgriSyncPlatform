// Rules: renewing the access token. What goes to the server, and what each answer leads to.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { FakeServer, NO_ANSWER, ok, status, type Answer } from '../support/server';
import {
  DEVICE_KEY,
  HOUR,
  MINUTE,
  NOON,
  PERSON,
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
  restoreClock();
});

describe('what a renewal sends', () => {
  it('calls POST /user/auth/refresh, once, with credentials', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    server.when('POST', REFRESH, ok(renewedAt(NOON)));

    await renewSession();

    assert.deepEqual(server.log(), ['POST /user/auth/refresh']);
    assert.equal(server.calls[0].withCredentials, true);
  });

  it('sends the browser identity as its body, including rememberDevice: true', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    const thisBrowser = '0f8fad5b-d9cb-469f-a165-70867728950e';
    browser.store.put(DEVICE_KEY, thisBrowser);
    server.when('POST', REFRESH, ok(renewedAt(NOON)));

    await renewSession();

    assert.deepEqual(server.calls[0].body, {
      deviceId: thisBrowser,
      deviceName: 'Control room (browser)',
      platform: 'web',
      rememberDevice: true,
    });
  });
});

describe('a renewal the server accepts', () => {
  it('is returned: the new token and expiry, the same user id, the SAME sign-in time', async () => {
    const { renewSession } = await load();
    const before = keepAnExpiredSession();
    server.when('POST', REFRESH, ok(renewedAt(NOON, 'token-new')));

    const renewed = await renewSession();

    assert.deepEqual(renewed, {
      accessToken: 'token-new',
      refreshToken: null,
      userId: PERSON,
      expiresAtUtc: at(NOON + 15 * MINUTE),
      signedInAtUtc: before.signedInAtUtc,
    });
    assert.equal(renewed?.signedInAtUtc, at(NOON - 3 * HOUR), 'not the time of the renewal');
  });

  it('is stored', async () => {
    const { renewSession } = await load();
    const before = keepAnExpiredSession();
    server.when('POST', REFRESH, ok(renewedAt(NOON, 'token-new')));

    await renewSession();

    assert.deepEqual(keptSession(browser.store), {
      accessToken: 'token-new',
      refreshToken: null,
      userId: PERSON,
      expiresAtUtc: at(NOON + 15 * MINUTE),
      signedInAtUtc: before.signedInAtUtc,
    });
  });

  it('puts no refresh token in the store, even when the answer carries one', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    server.when(
      'POST',
      REFRESH,
      ok({ ...renewedAt(NOON, 'token-new'), refreshToken: 'refresh-token-from-the-body' }),
    );

    const renewed = await renewSession();

    assert.equal(renewed?.refreshToken, null);
    assert.equal(keptSession(browser.store)?.refreshToken, null);
    assert.ok(!browser.store.everything().includes('refresh-token-from-the-body'));
  });

  it('is accepted when it says plainly that it is not held', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    server.when('POST', REFRESH, ok({ ...renewedAt(NOON, 'token-new'), deviceCheckRequired: false }));

    assert.equal((await renewSession())?.accessToken, 'token-new');
    assert.equal(keptSession(browser.store)?.accessToken, 'token-new');
  });
});

describe('a renewal the server refuses', () => {
  it("the server's 401 gives null", async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    server.when('POST', REFRESH, status(401));

    assert.equal(await renewSession(), null);
  });
});

describe('a renewal that gets no verdict', () => {
  const noVerdicts: Array<[what: string, answer: Answer]> = [
    ['no answer', NO_ANSWER],
    ['429', status(429, { message: 'Too many calls.' })],
    ['500', status(500)],
    ['502', status(502)],
    ['503', status(503)],
  ];
  for (const [what, answer] of noVerdicts) {
    it(`${what}: rejects, and the stored session is untouched`, async () => {
      const { renewSession } = await load();
      keepAnExpiredSession();
      const storedBefore = browser.store.peek(SESSION_KEY);
      server.when('POST', REFRESH, answer);

      await assert.rejects(renewSession());

      assert.equal(browser.store.peek(SESSION_KEY), storedBefore);
    });
  }
});

describe('a held answer', () => {
  // Anything but a plain `false`. (A missing field is the ordinary accepted answer above.)
  for (const held of [true, 'true', 'false', 1, 0, '', 'yes', {}, []]) {
    it(`deviceCheckRequired ${JSON.stringify(held)}: gives null and its token is never stored`, async () => {
      const { renewSession } = await load();
      keepAnExpiredSession();
      const storedBefore = browser.store.peek(SESSION_KEY);
      server.when(
        'POST',
        REFRESH,
        ok({ ...renewedAt(NOON, 'token-of-a-held-sign-in'), deviceCheckRequired: held }),
      );

      assert.equal(await renewSession(), null);

      assert.ok(!browser.store.everything().includes('token-of-a-held-sign-in'));
      assert.equal(browser.store.peek(SESSION_KEY), storedBefore);
    });
  }
});

describe('an answer for another person', () => {
  it('gives null and is not stored', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    const storedBefore = browser.store.peek(SESSION_KEY);
    server.when(
      'POST',
      REFRESH,
      ok({ ...renewedAt(NOON, 'token-of-somebody-else'), userId: 'ffffffff-0000-4000-8000-000000000001' }),
    );

    assert.equal(await renewSession(), null);

    assert.ok(!browser.store.everything().includes('token-of-somebody-else'));
    assert.equal(browser.store.peek(SESSION_KEY), storedBefore);
  });

  it('the same id in other letter case is the same person: accepted and stored', async () => {
    const { renewSession } = await load();
    keepAnExpiredSession();
    server.when(
      'POST',
      REFRESH,
      ok({ ...renewedAt(NOON, 'token-new'), userId: PERSON.toUpperCase() }),
    );

    const renewed = await renewSession();

    assert.equal(renewed?.accessToken, 'token-new');
    assert.equal(renewed?.userId.toLowerCase(), PERSON);
    assert.equal(keptSession(browser.store)?.accessToken, 'token-new');
  });
});

describe('an answer that carries no session', () => {
  const lacking: Array<[what: string, body: Record<string, unknown>]> = [
    ['no token', { userId: PERSON, expiresAtUtc: at(NOON + 15 * MINUTE) }],
    ['a blank token', { ...renewedAt(NOON), accessToken: '' }],
    ['a null token', { ...renewedAt(NOON), accessToken: null }],
    ['no expiry', { userId: PERSON, accessToken: 'token-without-expiry' }],
    ['a blank expiry', { ...renewedAt(NOON, 'token-without-expiry'), expiresAtUtc: '' }],
    ['a null expiry', { ...renewedAt(NOON, 'token-without-expiry'), expiresAtUtc: null }],
  ];
  for (const [what, body] of lacking) {
    it(`${what}: gives null`, async () => {
      const { renewSession } = await load();
      keepAnExpiredSession();
      server.when('POST', REFRESH, ok(body));

      assert.equal(await renewSession(), null);
      assert.ok(!browser.store.everything().includes('token-without-expiry'));
    });
  }
});
