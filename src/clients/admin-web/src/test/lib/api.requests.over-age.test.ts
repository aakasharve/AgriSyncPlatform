// Rule: a session older than 12 hours at request time: the server is told (POST
// /user/auth/logout with credentials), the session is cleared, /login?signedOut=max-age opens
// and the data request is never sent. This ends the session, so it has a page load to itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { watchForgetting, type Forgetting } from '../support/forgetting';
import { FakeServer, ok } from '../support/server';
import {
  HOUR,
  NOON,
  SESSION_KEY,
  SIGN_OUT_OWED_KEY,
  keepSession,
  renewedAt,
  sessionAt,
} from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const DATA = '/admin/reports/today';
const REFRESH = '/user/auth/refresh';
const LOGOUT = '/user/auth/logout';

describe('a data request made when the session is exactly 12 hours old', () => {
  let forgetting: Forgetting;
  let outcome = 'not run';
  let emptyTheCache: () => void = () => undefined;
  const whenTheServerWasTold = { marker: 'not seen' as string | null, session: 'not seen' as string | null };

  before(async () => {
    setClock(NOON);
    // The access token itself is still good for ten minutes: only the age of the session counts.
    keepSession(browser.store, sessionAt(NOON, { token: 'token-fresh', signedInAgoMs: 12 * HOUR }));
    server.when('POST', LOGOUT, () => {
      whenTheServerWasTold.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
      whenTheServerWasTold.session = browser.store.peek(SESSION_KEY);
      return ok();
    });
    server.when('GET', DATA, ok({ rows: 3 }));
    server.when('POST', REFRESH, ok(renewedAt(NOON)));
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();
    forgetting = watchForgetting(api.onSessionForgotten, queryClient);

    outcome = await api.adminApi.get(DATA).then(
      () => 'answered',
      () => 'failed',
    );
  });

  after(() => {
    emptyTheCache();
    restoreClock();
  });

  it('tells the server: one POST /user/auth/logout, with credentials', () => {
    assert.equal(server.callsTo(LOGOUT).length, 1);
    assert.equal(server.callsTo(LOGOUT)[0].method, 'POST');
    assert.equal(server.callsTo(LOGOUT)[0].withCredentials, true);
  });

  it('clears the session', () => {
    assert.equal(browser.store.peek(SESSION_KEY), null);
  });

  it('opens /login?signedOut=max-age', () => {
    assert.deepEqual(browser.opened, ['/login?signedOut=max-age']);
  });

  it('never sends the data request', () => {
    assert.equal(server.callsTo(DATA).length, 0);
    assert.equal(outcome, 'failed');
  });

  it('had marked the sign-out as owed, and forgotten the session, before the server was told', () => {
    assert.equal(whenTheServerWasTold.marker, '1');
    assert.equal(whenTheServerWasTold.session, null);
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });
});
