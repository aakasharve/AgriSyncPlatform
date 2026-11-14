// Rules: the person's own sign-out, when the server cannot be told. One sign-out per page load,
// so this scenario has a file to itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { watchForgetting, type Forgetting } from '../support/forgetting';
import { FakeServer, NO_ANSWER } from '../support/server';
import { NOON, SESSION_KEY, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

describe('the person presses Sign out and the server cannot be told', () => {
  let forgetting: Forgetting;
  let emptyTheCache: () => void = () => undefined;
  const whenTheCallArrived = { marker: 'not seen' as string | null, session: 'not seen' as string | null };

  before(async () => {
    setClock(NOON);
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-the-person' }));
    server.when('POST', LOGOUT, () => {
      whenTheCallArrived.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
      whenTheCallArrived.session = browser.store.peek(SESSION_KEY);
      return NO_ANSWER;
    });
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();
    forgetting = watchForgetting(api.onSessionForgotten, queryClient);

    await api.signOut();
  });

  after(() => {
    emptyTheCache();
    restoreClock();
  });

  it('tried to tell the server, once, with the marker set and the session gone', () => {
    assert.equal(server.callsTo(LOGOUT).length, 1);
    assert.equal(whenTheCallArrived.marker, '1');
    assert.equal(whenTheCallArrived.session, null);
  });

  it('the owed marker stays', () => {
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), '1');
  });

  it('the session is still gone', () => {
    assert.equal(browser.store.peek(SESSION_KEY), null);
  });

  it('the login page still opens, with no reason', () => {
    assert.deepEqual(browser.opened, ['/login']);
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });
});
