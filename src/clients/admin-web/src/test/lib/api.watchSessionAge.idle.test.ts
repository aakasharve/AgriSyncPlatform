// Rule: watchSessionAge ends an open, idle page's session with 'max-age' when the 12 hours pass.
// This ends the session, so it has a page load to itself. The scenario is played once, and each
// test looks at one moment of it.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { fakeTime, flush, restoreClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { watchForgetting, type Forgetting } from '../support/forgetting';
import { FakeServer, ok } from '../support/server';
import {
  HOUR,
  MINUTE,
  NOON,
  SECOND,
  SESSION_KEY,
  SIGN_OUT_OWED_KEY,
  keepSession,
  sessionAt,
} from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';
const LEFT_AT_THE_START = 2 * MINUTE + 30 * SECOND;

describe('a page left open, with nobody using it, while the session reaches 12 hours', () => {
  let forgetting: Forgetting;
  let emptyTheCache: () => void = () => undefined;
  let stopWatching: () => void = () => undefined;

  /** One second before the session is 12 hours old. */
  const justBefore = { session: 'not seen' as string | null, opened: ['not seen'], calls: ['not seen'], listenerCalls: -1 };
  /** One second after. */
  const justAfter = { session: 'not seen' as string | null, opened: ['not seen'], marker: 'not seen' as string | null };

  before(async () => {
    // Two and a half minutes are left of the 12 hours. (Not a whole number of minutes: a watch
    // that only looked at the clock once a minute would be half a minute late.)
    const time = fakeTime(NOON);
    keepSession(
      browser.store,
      sessionAt(NOON, { token: 'token-of-the-person', signedInAgoMs: 12 * HOUR - LEFT_AT_THE_START }),
    );
    server.when('POST', LOGOUT, ok());
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();
    forgetting = watchForgetting(api.onSessionForgotten, queryClient);

    stopWatching = api.watchSessionAge();
    await flush();

    // Nobody touches the page. Time passes a second at a time.
    await time.passInSteps(LEFT_AT_THE_START - SECOND, SECOND);
    justBefore.session = browser.store.peek(SESSION_KEY);
    justBefore.opened = [...browser.opened];
    justBefore.calls = server.log();
    justBefore.listenerCalls = forgetting.listenerCalls();

    await time.passInSteps(2 * SECOND, SECOND);
    justAfter.session = browser.store.peek(SESSION_KEY);
    justAfter.opened = [...browser.opened];
    justAfter.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
  });

  after(() => {
    stopWatching();
    emptyTheCache();
    restoreClock();
  });

  it('is left alone one second before the 12 hours', () => {
    assert.notEqual(justBefore.session, null, 'the session is still stored');
    assert.deepEqual(justBefore.opened, [], 'the login page is not opened');
    assert.deepEqual(justBefore.calls, [], 'nothing was sent to the server');
    assert.equal(justBefore.listenerCalls, 0);
  });

  it('has its session cleared when the 12 hours pass', () => {
    assert.equal(justAfter.session, null);
  });

  it("is sent to the login page with 'max-age'", () => {
    assert.deepEqual(justAfter.opened, ['/login?signedOut=max-age']);
  });

  it('tells the server: one POST /user/auth/logout, with credentials', () => {
    assert.deepEqual(server.log(), ['POST /user/auth/logout']);
    assert.equal(server.calls[0].withCredentials, true);
  });

  it('owes nothing any more once the server has answered', () => {
    assert.equal(justAfter.marker, null);
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });
});
