// Rule (CR-3, H10): a data route that answers 401 `control_room.door_session_required` means the
// session did not begin at the console's own sign-in. No renewal is tried (it would carry the same
// mark); the session is forgotten, the server is told, and /login?signedOut=door-required opens.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, ok, status } from '../support/server';
import { NOON, SESSION_KEY, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const DATA = '/shramsafal/admin/mis/company';
const REFRESH = '/user/auth/refresh';
const LOGOUT = '/user/auth/logout';

describe('a data route answers 401 control_room.door_session_required', () => {
  let outcome = 'not run';
  let emptyTheCache: () => void = () => undefined;

  before(async () => {
    setClock(NOON);
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-a-password-session' }));
    server.when(
      'GET',
      DATA,
      status(401, {
        code: 'control_room.door_session_required',
        message: "Sign in again on the control room's sign-in page.",
      }),
    );
    server.when('POST', LOGOUT, ok());
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();

    outcome = await api.adminApi.get(DATA).then(
      () => 'answered',
      () => 'failed',
    );
  });

  after(() => {
    emptyTheCache();
    restoreClock();
  });

  it('tries no renewal', () => {
    assert.equal(server.callsTo(REFRESH).length, 0);
  });

  it('clears the session', () => {
    assert.equal(browser.store.peek(SESSION_KEY), null);
  });

  it('opens /login?signedOut=door-required', () => {
    assert.deepEqual(browser.opened, ['/login?signedOut=door-required']);
  });

  it('tells the server, and the data request is not sent again', () => {
    assert.equal(server.callsTo(LOGOUT).length, 1);
    assert.equal(server.callsTo(DATA).length, 1);
    assert.equal(outcome, 'failed');
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
  });
});
