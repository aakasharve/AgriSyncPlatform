// Rule: while the page is ending a session (an endSession(...) has begun), settleOwedSignOut()
// answers 'owed' and makes no call of its own. Here the session ends with 'ended', which tells
// the server nothing, and a marker was already in the store from before. This ends the session:
// a page load to itself.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, ok } from '../support/server';
import { NOON, SESSION_KEY, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

describe("paying an owed sign-out once the console has begun ending the session with 'ended'", () => {
  let outcome = 'not run';
  let markerAfterwards: string | null = 'not seen';
  let sessionAfterwards: string | null = 'not seen';

  before(async () => {
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-the-person' }));
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    server.when('POST', '/user/auth/logout', ok());
    const { api } = await loadConsole(server);

    const ending = api.endSession('ended');
    outcome = await api.settleOwedSignOut();
    await ending;
    await flush();
    markerAfterwards = browser.store.peek(SIGN_OUT_OWED_KEY);
    sessionAfterwards = browser.store.peek(SESSION_KEY);
  });

  it("answers 'owed', and the marker that was there stays", () => {
    assert.equal(outcome, 'owed');
    assert.equal(markerAfterwards, '1');
  });

  it('makes no call of its own: nothing at all goes to the server', () => {
    assert.deepEqual(server.log(), []);
  });

  it('the session is ended all the same', () => {
    assert.equal(sessionAfterwards, null);
    assert.deepEqual(browser.opened, ['/login?signedOut=ended']);
  });
});
