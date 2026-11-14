// Rule: while a sign-in call is in the air, settleOwedSignOut() answers 'owed', makes NO
// sign-out call, and the marker stays. The answer to a sign-out call takes the refresh cookie
// away, and it could arrive just as the sign-in's answer puts a new one there.
//
// "A sign-in call" is a call through the console's HTTP client to any /user/auth/ route except
// /user/auth/logout. Nothing here is told to the server, so the tests can share a page load.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, heldAnswer, ok, status } from '../support/server';
import { SESSION_KEY, SIGN_OUT_OWED_KEY } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

beforeEach(() => {
  browser.store.wipe();
  server.reset();
});

describe('paying an owed sign-out while a sign-in call is in the air', () => {
  for (const route of ['/user/auth/login', '/user/auth/verify-otp', '/user/auth/start-otp']) {
    it(`a call to ${route} in the air: 'owed', no sign-out call, and the marker stays`, async () => {
      const { api } = await loadConsole(server);
      browser.store.put(SIGN_OUT_OWED_KEY, '1');
      const held = heldAnswer();
      server.when('POST', route, () => held.answer);
      server.when('POST', LOGOUT, ok());

      const signIn = api.adminApi.post(route, { phone: '9999999999' }).then(
        () => 'answered',
        () => 'refused',
      );
      await flush();
      assert.deepEqual(server.log(), [`POST ${route}`], 'the sign-in call is in the air');

      const outcome = await api.settleOwedSignOut();
      await flush();

      assert.equal(outcome, 'owed');
      assert.equal(server.callsTo(LOGOUT).length, 0, 'no sign-out call is made');
      assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), '1', 'the marker stays');
      assert.equal(browser.store.peek(SESSION_KEY), null);

      held.give(status(401));
      assert.equal(await signIn, 'refused');
    });
  }

  it('asked twice while the same sign-in call is in the air: owed both times, still no sign-out call', async () => {
    const { api } = await loadConsole(server);
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    const held = heldAnswer();
    server.when('POST', '/user/auth/verify-otp', () => held.answer);
    server.when('POST', LOGOUT, ok());

    const signIn = api.adminApi.post('/user/auth/verify-otp', { otp: '000000' }).then(
      () => 'answered',
      () => 'refused',
    );
    await flush();

    assert.equal(await api.settleOwedSignOut(), 'owed');
    assert.equal(await api.settleOwedSignOut(), 'owed');
    assert.equal(server.callsTo(LOGOUT).length, 0);
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), '1');

    held.give(status(401));
    assert.equal(await signIn, 'refused');
  });
});
