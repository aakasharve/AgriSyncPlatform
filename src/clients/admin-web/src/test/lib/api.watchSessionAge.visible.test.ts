// Rule: watchSessionAge checks again when the tab becomes visible (`visibilitychange` on
// `document`). A timer does not count the time a computer spent asleep, so here the clock jumps
// and no timer runs: only the tab coming back can notice. This ends the session, so it has a
// page load to itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { fakeTime, flush, restoreClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { watchForgetting, type Forgetting } from '../support/forgetting';
import { FakeServer, ok } from '../support/server';
import { HOUR, NOON, SESSION_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

describe('a tab that comes back into view', () => {
  let forgetting: Forgetting;
  let emptyTheCache: () => void = () => undefined;
  let stopWatching: () => void = () => undefined;

  /** Back in view one hour later: the session is 11 hours old. */
  const backInTime = { session: 'not seen' as string | null, opened: ['not seen'], calls: ['not seen'] };
  /** The computer slept past the 12 hours; the tab is not in view yet. */
  const asleepPastTheLimit = { session: 'not seen' as string | null, opened: ['not seen'] };
  /** Back in view after that. */
  const backTooLate = { session: 'not seen' as string | null, opened: ['not seen'] };

  function tabBecomes(state: 'visible' | 'hidden'): Promise<void> {
    browser.document.visibilityState = state;
    browser.document.fire('visibilitychange');
    return flush();
  }

  before(async () => {
    // The person signed in ten hours ago: two hours are left.
    const time = fakeTime(NOON);
    keepSession(
      browser.store,
      sessionAt(NOON, { token: 'token-of-the-person', signedInAgoMs: 10 * HOUR }),
    );
    server.when('POST', LOGOUT, ok());
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();
    forgetting = watchForgetting(api.onSessionForgotten, queryClient);

    stopWatching = api.watchSessionAge();
    await flush();

    await tabBecomes('hidden');
    time.jumpTo(NOON + 1 * HOUR);
    await tabBecomes('visible');
    backInTime.session = browser.store.peek(SESSION_KEY);
    backInTime.opened = [...browser.opened];
    backInTime.calls = server.log();

    await tabBecomes('hidden');
    time.jumpTo(NOON + 3 * HOUR);
    await flush();
    asleepPastTheLimit.session = browser.store.peek(SESSION_KEY);
    asleepPastTheLimit.opened = [...browser.opened];

    await tabBecomes('visible');
    backTooLate.session = browser.store.peek(SESSION_KEY);
    backTooLate.opened = [...browser.opened];
  });

  after(() => {
    stopWatching();
    emptyTheCache();
    restoreClock();
  });

  it('keeps its session when it comes back before the 12 hours', () => {
    assert.notEqual(backInTime.session, null);
    assert.deepEqual(backInTime.opened, []);
    assert.deepEqual(backInTime.calls, []);
  });

  it('(the test itself) no timer ran while the computer slept past the 12 hours', () => {
    assert.notEqual(asleepPastTheLimit.session, null);
    assert.deepEqual(asleepPastTheLimit.opened, []);
  });

  it('has its session cleared when it comes back after the 12 hours', () => {
    assert.equal(backTooLate.session, null);
  });

  it("is sent to the login page with 'max-age'", () => {
    assert.deepEqual(backTooLate.opened, ['/login?signedOut=max-age']);
  });

  it('tells the server: one POST /user/auth/logout, with credentials', () => {
    assert.deepEqual(server.log(), ['POST /user/auth/logout']);
    assert.equal(server.calls[0].withCredentials, true);
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });
});
