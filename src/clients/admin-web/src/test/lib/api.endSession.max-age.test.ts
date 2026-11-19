// Rule: endSession('max-age') tells the server and marks first. One end of a session per page
// load, so this scenario has a file to itself.

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

describe("the console ends the session with 'max-age'", () => {
  let forgetting: Forgetting;
  let emptyTheCache: () => void = () => undefined;
  const whenTheServerWasTold = { marker: 'not seen' as string | null, session: 'not seen' as string | null };

  before(async () => {
    setClock(NOON);
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-the-person' }));
    server.when('POST', LOGOUT, () => {
      whenTheServerWasTold.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
      whenTheServerWasTold.session = browser.store.peek(SESSION_KEY);
      return ok();
    });
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();
    forgetting = watchForgetting(api.onSessionForgotten, queryClient);

    await api.endSession('max-age');
  });

  after(() => {
    emptyTheCache();
    restoreClock();
  });

  it('tells the server: one POST /user/auth/logout, with credentials', () => {
    assert.deepEqual(server.log(), ['POST /user/auth/logout']);
    assert.equal(server.calls[0].withCredentials, true);
  });

  it('marks the sign-out as owed first: the marker holds "1" when the server is told', () => {
    assert.equal(whenTheServerWasTold.marker, '1');
  });

  it('has forgotten the session by the time the server is told', () => {
    assert.equal(whenTheServerWasTold.session, null);
    assert.equal(browser.store.peek(SESSION_KEY), null);
  });

  it('owes nothing any more once the server has answered', () => {
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
  });

  it('opens /login?signedOut=max-age', () => {
    assert.deepEqual(browser.opened, ['/login?signedOut=max-age']);
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });
});
