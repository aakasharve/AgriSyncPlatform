// Rule: a renewal the server refuses during a data request clears the session and opens
// /login?signedOut=ended. Here the renewal was started by the data route's own 401. This ends
// the session, so it has a page load to itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { watchForgetting, type Forgetting } from '../support/forgetting';
import { FakeServer, ok, status } from '../support/server';
import { NOON, SESSION_KEY, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const DATA = '/admin/reports/today';
const REFRESH = '/user/auth/refresh';
const LOGOUT = '/user/auth/logout';

describe('a data route answers 401, and the server then refuses the renewal', () => {
  let forgetting: Forgetting;
  let outcome = 'not run';
  let emptyTheCache: () => void = () => undefined;

  before(async () => {
    setClock(NOON);
    keepSession(browser.store, sessionAt(NOON, { token: 'token-refused' }));
    server.when('GET', DATA, status(401));
    server.when('POST', REFRESH, status(401));
    server.when('POST', LOGOUT, ok());
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

  it('asks for one renewal', () => {
    assert.equal(server.callsTo(REFRESH).length, 1);
  });

  it('clears the session', () => {
    assert.equal(browser.store.peek(SESSION_KEY), null);
  });

  it('opens /login?signedOut=ended', () => {
    assert.deepEqual(browser.opened, ['/login?signedOut=ended']);
  });

  it('does not send the data request again', () => {
    assert.equal(server.callsTo(DATA).length, 1);
    assert.equal(outcome, 'failed');
  });

  it('makes no sign-out call and leaves no owed marker', () => {
    assert.equal(server.callsTo(LOGOUT).length, 0);
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });
});
