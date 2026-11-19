// Rules: the person's own sign-out, when the server answers. One sign-out per page load, so this
// scenario has a file to itself: it is played once, and each test looks at one rule.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush, restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { watchForgetting, type Forgetting } from '../support/forgetting';
import { FakeServer, heldAnswer, ok, type Call } from '../support/server';
import { NOON, SESSION_KEY, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const DATA = '/admin/reports/today';
const LOGOUT = '/user/auth/logout';

describe('the person presses Sign out, twice, and the server answers', () => {
  let forgetting: Forgetting;
  let emptyTheCache: () => void = () => undefined;

  /** What the browser's store held at the moment the sign-out call reached the server. */
  const whenTheCallArrived = { marker: 'not seen' as string | null, session: 'not seen' as string | null };
  /** While the server had not answered yet. */
  const whileInTheAir = { signOutCalls: -1, opened: ['not seen'] };
  /** Once the server had answered and both presses were done. */
  const afterTheAnswer = { marker: 'not seen' as string | null, opened: ['not seen'] };
  let dataAskedWhileInTheAir = 'not run';
  let dataAskedAfterwards = 'not run';
  let signOutCalls: Call[] = [];

  before(async () => {
    setClock(NOON);
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-the-person' }));
    const held = heldAnswer();
    server.when('POST', LOGOUT, () => {
      whenTheCallArrived.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
      whenTheCallArrived.session = browser.store.peek(SESSION_KEY);
      return held.answer;
    });
    server.when('GET', DATA, ok({ rows: 3 }));
    const { api, queryClient } = await loadConsole(server);
    emptyTheCache = () => queryClient.clear();
    forgetting = watchForgetting(api.onSessionForgotten, queryClient);
    assert.equal(forgetting.cacheStillHolds(), true, 'the cache holds something to begin with');
    const askForData = () =>
      api.adminApi.get(DATA).then(
        () => 'answered',
        () => 'stopped',
      );

    const firstPress = api.signOut();
    const secondPress = api.signOut();
    // A page that is still asking for data after the press.
    const dataWhileInTheAir = askForData();
    await flush();
    whileInTheAir.signOutCalls = server.callsTo(LOGOUT).length;
    whileInTheAir.opened = [...browser.opened];

    held.give(ok());
    await Promise.all([firstPress, secondPress]);
    afterTheAnswer.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
    afterTheAnswer.opened = [...browser.opened];

    dataAskedWhileInTheAir = await dataWhileInTheAir;
    dataAskedAfterwards = await askForData();
    signOutCalls = server.callsTo(LOGOUT);
  });

  after(() => {
    emptyTheCache();
    restoreClock();
  });

  it('when the sign-out call reaches the server, the owed marker already holds "1"', () => {
    assert.equal(whenTheCallArrived.marker, '1');
  });

  it('when the sign-out call reaches the server, the stored session is already gone', () => {
    assert.equal(whenTheCallArrived.session, null);
  });

  it('the sign-out call is POST /user/auth/logout, with credentials', () => {
    assert.equal(signOutCalls[0]?.method, 'POST');
    assert.equal(signOutCalls[0]?.withCredentials, true);
  });

  it('the sign-out call carries no bearer token', () => {
    assert.equal(signOutCalls[0]?.authorization, null);
  });

  it('when the server answers, the marker is removed', () => {
    assert.equal(afterTheAnswer.marker, null);
  });

  it('the login page opens, with no reason', () => {
    assert.deepEqual(afterTheAnswer.opened, ['/login']);
  });

  it('two presses make one call', () => {
    assert.equal(whileInTheAir.signOutCalls, 1, 'while the server had not answered');
    assert.equal(signOutCalls.length, 1, 'in all');
    assert.deepEqual(browser.opened, ['/login'], 'and the login page is opened once');
  });

  it('calls the onSessionForgotten listener', () => {
    assert.ok(forgetting.listenerCalls() >= 1);
  });

  it('empties the shared data cache', () => {
    assert.equal(forgetting.cacheStillHolds(), false);
  });

  it('a data request made after the press, while the server is being told, never reaches the server', () => {
    assert.equal(dataAskedWhileInTheAir, 'stopped');
    assert.equal(server.callsTo(DATA).length, 0);
  });

  it('a data request made after the sign-out is done never reaches the server', () => {
    assert.equal(dataAskedAfterwards, 'stopped');
    assert.equal(server.callsTo(DATA).length, 0);
  });
});
