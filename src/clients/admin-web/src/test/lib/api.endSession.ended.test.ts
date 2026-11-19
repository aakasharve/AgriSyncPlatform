// Rule: endSession('ended') makes no sign-out call and leaves no marker. One end of a session
// per page load, so this scenario has a file to itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { watchForgetting, type Forgetting } from '../support/forgetting';
import { FakeServer, ok } from '../support/server';
import { NOON, SESSION_KEY, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

describe("the console ends the session with 'ended'", () => {
  let forgetting: Forgetting;
  let emptyTheCache: () => void = () => undefined;

  before(async () => {
    setClock(NOON);
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-the-person' }));
    server.when('POST', LOGOUT, ok());
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();
    forgetting = watchForgetting(api.onSessionForgotten, queryClient);

    await api.endSession('ended');
  });

  after(() => {
    emptyTheCache();
    restoreClock();
  });

  it('makes no sign-out call: nothing at all goes to the server', () => {
    assert.deepEqual(server.log(), []);
  });

  it('leaves no owed marker', () => {
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
  });

  it('clears the session', () => {
    assert.equal(browser.store.peek(SESSION_KEY), null);
  });

  it('opens /login?signedOut=ended', () => {
    assert.deepEqual(browser.opened, ['/login?signedOut=ended']);
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });
});
