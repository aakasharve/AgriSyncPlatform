// Rule: the count of sign-in calls in the air comes down exactly once per call, answered or
// failed. Here the server REFUSES the sign-in calls (401): afterwards a settleOwedSignOut() with
// the marker set does call the server (it is not stuck on 'owed').
//
// The scenario ends with the server told, which a page keeps for the page load: a file to itself.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, heldAnswer, ok, status } from '../support/server';
import { SIGN_OUT_OWED_KEY } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';
const LOGIN = '/user/auth/login';

describe('an owed sign-out on a login page where the server refuses the sign-in calls', () => {
  let firstSignIn = 'not run';
  let markerAfterTheFirst: string | null = 'not seen';
  const whileTheSecondIsInTheAir = { outcome: 'not run', signOutCalls: -1 };
  let secondSignIn = 'not run';
  const whenBothAreOver = { outcome: 'not run', signOutCalls: -1, marker: 'not seen' as string | null };

  before(async () => {
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    server.when('POST', LOGOUT, ok());
    const { api } = await loadConsole(server);
    const signIn = () =>
      api.adminApi.post(LOGIN, { phone: '9999999999', password: 'wrong' }).then(
        () => 'answered',
        () => 'refused',
      );

    // The first sign-in call is refused.
    server.when('POST', LOGIN, status(401));
    firstSignIn = await signIn();
    markerAfterTheFirst = browser.store.peek(SIGN_OUT_OWED_KEY);

    // A second one is in the air.
    const held = heldAnswer();
    server.when('POST', LOGIN, () => held.answer);
    const second = signIn();
    await flush();
    whileTheSecondIsInTheAir.outcome = await api.settleOwedSignOut();
    await flush();
    whileTheSecondIsInTheAir.signOutCalls = server.callsTo(LOGOUT).length;

    // It is refused as well.
    held.give(status(401));
    secondSignIn = await second;

    whenBothAreOver.outcome = await api.settleOwedSignOut();
    whenBothAreOver.signOutCalls = server.callsTo(LOGOUT).length;
    whenBothAreOver.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
  });

  it('a refused sign-in call leaves the marker set', () => {
    assert.equal(firstSignIn, 'refused');
    assert.equal(markerAfterTheFirst, '1');
  });

  it('the refused call came off the count once, not twice: the next call in the air still holds the sign-out back', () => {
    assert.equal(whileTheSecondIsInTheAir.outcome, 'owed');
    assert.equal(whileTheSecondIsInTheAir.signOutCalls, 0);
  });

  it("once the refused calls are over, the owed sign-out is paid: the server is called and the answer is 'told'", () => {
    assert.equal(secondSignIn, 'refused');
    assert.equal(whenBothAreOver.outcome, 'told');
    assert.equal(whenBothAreOver.signOutCalls, 1);
    assert.equal(whenBothAreOver.marker, null);
  });
});
