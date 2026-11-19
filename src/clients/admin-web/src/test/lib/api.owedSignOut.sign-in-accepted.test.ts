// Rule: a 2xx answer from /user/auth/login or from /user/auth/verify-otp (held or not) removes
// the owed marker, and a later settleOwedSignOut() answers 'none' with no sign-out call: the
// server has given this browser a new cookie, and a sign-out call now would end the new sign-in.
// A 2xx from another sign-in route leaves the marker alone.
//
// Nothing here is told to the server, so the tests can share a page load.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { loadConsole } from '../support/console';
import { FakeServer, ok, status, type Answer } from '../support/server';
import { MINUTE, NOON, PERSON, SIGN_OUT_OWED_KEY, at } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';
const LOGIN = '/user/auth/login';
const VERIFY = '/user/auth/verify-otp';

const signedIn = {
  userId: PERSON,
  accessToken: 'token-of-the-new-sign-in',
  expiresAtUtc: at(NOON + 15 * MINUTE),
};
/** The server holds this sign-in until the account question is answered. */
const heldSignIn = { ...signedIn, deviceCheckRequired: true };

beforeEach(() => {
  browser.store.wipe();
  server.reset();
});

describe('an owed sign-out and a sign-in the server accepts', () => {
  const accepted: Array<[what: string, route: string, answer: Answer]> = [
    ['/user/auth/login', LOGIN, ok(signedIn)],
    ['/user/auth/login, held', LOGIN, ok(heldSignIn)],
    ['/user/auth/verify-otp', VERIFY, ok(signedIn)],
    ['/user/auth/verify-otp, held', VERIFY, ok(heldSignIn)],
    ['/user/auth/verify-otp, answered 201', VERIFY, status(201, signedIn)],
  ];
  for (const [what, route, answer] of accepted) {
    it(`a 2xx from ${what} removes the owed marker`, async () => {
      const { api } = await loadConsole(server);
      browser.store.put(SIGN_OUT_OWED_KEY, '1');
      server.when('POST', route, answer);

      await api.adminApi.post(route, { phone: '9999999999' });

      assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
      assert.equal(api.isSignOutOwed(), false);
    });

    it(`after a 2xx from ${what}, a later settleOwedSignOut() answers 'none' with no sign-out call`, async () => {
      const { api } = await loadConsole(server);
      browser.store.put(SIGN_OUT_OWED_KEY, '1');
      server.when('POST', route, answer);
      server.when('POST', LOGOUT, ok());

      await api.adminApi.post(route, { phone: '9999999999' });
      const outcome = await api.settleOwedSignOut();

      assert.equal(outcome, 'none');
      assert.equal(server.callsTo(LOGOUT).length, 0);
      assert.deepEqual(server.log(), [`POST ${route}`]);
    });
  }

  for (const route of ['/user/auth/start-otp', '/user/auth/me']) {
    it(`a 2xx from another sign-in route (${route}) leaves the marker alone`, async () => {
      const { api } = await loadConsole(server);
      browser.store.put(SIGN_OUT_OWED_KEY, '1');
      server.when('POST', route, ok({ sent: true }));

      await api.adminApi.post(route, { phone: '9999999999' });

      assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), '1');
      assert.equal(api.isSignOutOwed(), true);
    });
  }

  for (const [what, route, answer] of [
    ['a 401 from /user/auth/login', LOGIN, status(401)],
    ['a 401 from /user/auth/verify-otp', VERIFY, status(401, { error: 'otp.mismatch' })],
  ] as const) {
    it(`${what} is no accepted sign-in: the marker stays`, async () => {
      const { api } = await loadConsole(server);
      browser.store.put(SIGN_OUT_OWED_KEY, '1');
      server.when('POST', route, answer);

      await assert.rejects(api.adminApi.post(route, { phone: '9999999999' }));

      assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), '1');
    });
  }
});
