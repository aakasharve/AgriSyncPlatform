// Rule: watchOwedSignOut stops by itself after 'told'. What a page has been told it keeps for
// the rest of the page load, so this scenario has a file to itself. It is played once, and each
// test looks at one moment of it.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { fakeTime, flush, restoreClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, NO_ANSWER, ok } from '../support/server';
import { MINUTE, NOON, SECOND, SIGN_OUT_OWED_KEY } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

describe('the login page watching an owed sign-out until the server is told', () => {
  const whileUnreachable = { calls: -1, outcomes: ['not seen'] };
  const onceTold = { calls: -1, outcomes: ['not seen'], marker: 'not seen' as string | null };
  const leftBehind = { timers: -1, listeners: -1 };
  const muchLater = { calls: -1, outcomes: ['not seen'] };

  before(async () => {
    const time = fakeTime(NOON);
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    server.when('POST', LOGOUT, NO_ANSWER);
    const { api } = await loadConsole(server);
    const outcomes: string[] = [];

    // The returned function is never called here: the watch has to stop by itself.
    api.watchOwedSignOut((outcome) => outcomes.push(outcome));
    await flush();
    whileUnreachable.calls = server.callsTo(LOGOUT).length;
    whileUnreachable.outcomes = [...outcomes];

    // The server can be reached again; the next try, 30 seconds after the first, gets through.
    server.when('POST', LOGOUT, ok());
    await time.pass(30 * SECOND);
    onceTold.calls = server.callsTo(LOGOUT).length;
    onceTold.outcomes = [...outcomes];
    onceTold.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
    leftBehind.timers = time.timersWaiting();
    leftBehind.listeners = browser.window.listening('online');

    await time.pass(10 * MINUTE);
    browser.window.fire('online');
    await flush();
    muchLater.calls = server.callsTo(LOGOUT).length;
    muchLater.outcomes = [...outcomes];
  });

  after(() => {
    restoreClock();
  });

  it('hears "owed" while the server cannot be reached', () => {
    assert.equal(whileUnreachable.calls, 1);
    assert.deepEqual(whileUnreachable.outcomes, ['owed']);
  });

  it('hears "told" from the try 30 seconds later, and the marker is removed', () => {
    assert.equal(onceTold.calls, 2);
    assert.deepEqual(onceTold.outcomes, ['owed', 'told']);
    assert.equal(onceTold.marker, null);
  });

  it('stops by itself after "told": no timer and no listener are left', () => {
    assert.equal(leftBehind.timers, 0);
    assert.equal(leftBehind.listeners, 0);
  });

  it('never asks the server again, not after ten minutes and not when the browser comes online', () => {
    assert.equal(muchLater.calls, 2);
    assert.deepEqual(muchLater.outcomes, ['owed', 'told']);
  });
});
