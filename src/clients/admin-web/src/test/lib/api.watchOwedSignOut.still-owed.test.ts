// Rules: watchOwedSignOut while the sign-out stays owed: it asks again every 30 seconds, and at
// once when the browser reports it is back online; the function it returns leaves no timer and
// no listener. (The time the server is told at last has a page load to itself.)

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { fakeTime, flush, restoreClock, type FakeTime } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, NO_ANSWER } from '../support/server';
import { MINUTE, NOON, SECOND, SIGN_OUT_OWED_KEY } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

describe('the login page watching an owed sign-out the server still cannot be told of', () => {
  let time: FakeTime;
  let outcomes: string[] = [];
  let stopWatching: () => void = () => undefined;

  beforeEach(async () => {
    browser.store.wipe();
    server.reset();
    time = fakeTime(NOON);
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    server.when('POST', LOGOUT, NO_ANSWER);
    const { api } = await loadConsole(server);

    outcomes = [];
    stopWatching = api.watchOwedSignOut((outcome) => outcomes.push(outcome));
    await flush();
  });

  afterEach(() => {
    stopWatching();
    restoreClock();
  });

  it('asks at once, and hears that the sign-out is still owed', () => {
    assert.equal(server.callsTo(LOGOUT).length, 1);
    assert.equal(server.callsTo(LOGOUT)[0].withCredentials, true);
    assert.deepEqual(outcomes, ['owed']);
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), '1');
  });

  it('asks again every 30 seconds while still owed, and not before', async () => {
    await time.pass(30 * SECOND - 1);
    assert.equal(server.callsTo(LOGOUT).length, 1, 'one millisecond short of 30 seconds');

    await time.pass(1);
    assert.equal(server.callsTo(LOGOUT).length, 2, 'at 30 seconds');

    await time.pass(30 * SECOND - 1);
    assert.equal(server.callsTo(LOGOUT).length, 2, 'one millisecond short of 60 seconds');

    await time.pass(1);
    assert.equal(server.callsTo(LOGOUT).length, 3, 'at 60 seconds');

    await time.pass(30 * SECOND);
    assert.equal(server.callsTo(LOGOUT).length, 4, 'at 90 seconds');
    assert.deepEqual(outcomes, ['owed', 'owed', 'owed', 'owed']);
  });

  it('asks at once when the browser reports it is back online', async () => {
    await time.pass(10 * SECOND);
    assert.equal(server.callsTo(LOGOUT).length, 1, 'ten seconds in, nothing new');

    browser.window.fire('online');
    await flush();

    assert.equal(server.callsTo(LOGOUT).length, 2, 'asked again without any time passing');
    assert.deepEqual(outcomes, ['owed', 'owed']);
  });

  it('the function it returns leaves no timer and no listener', async () => {
    assert.ok(time.timersWaiting() >= 1, 'while watching, a timer waits for the next try');
    assert.ok(browser.window.listening('online') >= 1, 'while watching, it listens for "online"');

    stopWatching();

    assert.equal(time.timersWaiting(), 0, 'no timer is left');
    assert.equal(browser.window.listening('online'), 0, 'no listener is left');

    await time.pass(5 * MINUTE);
    browser.window.fire('online');
    await flush();
    assert.equal(server.callsTo(LOGOUT).length, 1, 'and the server is never asked again');
    assert.deepEqual(outcomes, ['owed']);
  });
});
