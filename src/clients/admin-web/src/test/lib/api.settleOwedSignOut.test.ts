// Rules: the owed marker, and paying an owed sign-out when the server still cannot be told or
// when nothing is owed. (The time the server IS told has a page load to itself, next to this
// file.)

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { loadConsole } from '../support/console';
import { FakeServer, NO_ANSWER, ok } from '../support/server';
import { NOON, SESSION_KEY, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

beforeEach(() => {
  browser.store.wipe();
  server.reset();
});

describe('the owed marker', () => {
  it('is kept under admin.signout.owed.v1', () => {
    assert.equal(SIGN_OUT_OWED_KEY, 'admin.signout.owed.v1');
  });

  it('a sign-out is owed while the marker holds "1"', async () => {
    const { api } = await loadConsole(server);
    browser.store.put('admin.signout.owed.v1', '1');
    assert.equal(api.isSignOutOwed(), true);
  });

  it('no sign-out is owed without the marker', async () => {
    const { api } = await loadConsole(server);
    assert.equal(api.isSignOutOwed(), false);
  });

  it('no sign-out is owed, and nothing throws, when the store cannot be read', async () => {
    const { api } = await loadConsole(server);
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    browser.store.refuseReads = true;

    let owed: boolean | null = null;
    assert.doesNotThrow(() => {
      owed = api.isSignOutOwed();
    });
    assert.equal(owed, false);
  });

  it('clearOwedSignOut() removes the marker', async () => {
    const { api } = await loadConsole(server);
    browser.store.put(SIGN_OUT_OWED_KEY, '1');

    api.clearOwedSignOut();

    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
    assert.equal(api.isSignOutOwed(), false);
  });
});

describe('paying an owed sign-out', () => {
  it("no marker: 'none', and the server is not called", async () => {
    const { api } = await loadConsole(server);
    server.when('POST', LOGOUT, ok());

    assert.equal(await api.settleOwedSignOut(), 'none');

    assert.deepEqual(server.log(), []);
  });

  it("marker and an unreachable server: 'owed', and the marker is kept", async () => {
    const { api } = await loadConsole(server);
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    server.when('POST', LOGOUT, NO_ANSWER);

    assert.equal(await api.settleOwedSignOut(), 'owed');

    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), '1');
    assert.deepEqual(server.log(), ['POST /user/auth/logout'], 'the server was tried, once');
    assert.equal(server.calls[0].withCredentials, true);
  });

  it("marker with a stored session (somebody has signed in since): 'none', the marker is removed, and NO sign-out call is made", async () => {
    const { api } = await loadConsole(server);
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    const signedInSince = keepSession(browser.store, sessionAt(NOON, { token: 'token-of-a-new-sign-in' }));
    server.when('POST', LOGOUT, ok());

    assert.equal(await api.settleOwedSignOut(), 'none');

    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
    assert.deepEqual(server.log(), [], 'a sign-out call now would end the new sign-in');
    assert.deepEqual(JSON.parse(browser.store.peek(SESSION_KEY) ?? 'null'), signedInSince);
  });
});
