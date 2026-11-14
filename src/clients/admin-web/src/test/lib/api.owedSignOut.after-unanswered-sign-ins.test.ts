// Rule: the count of sign-in calls in the air comes down exactly once per call, answered or
// failed. Here the sign-in calls get NO ANSWER: afterwards a settleOwedSignOut() with the marker
// set does call the server (it is not stuck on 'owed').
//
// The scenario ends with the server told, which a page keeps for the page load: a file to itself.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, NO_ANSWER, heldAnswer, ok } from '../support/server';
import { SIGN_OUT_OWED_KEY } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';
const VERIFY = '/user/auth/verify-otp';

describe('an owed sign-out on a login page whose sign-in calls get no answer', () => {
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
      api.adminApi.post(VERIFY, { phone: '9999999999', otp: '123456' }).then(
        () => 'answered',
        () => 'failed',
      );

    // The first sign-in call gets no answer.
    server.when('POST', VERIFY, NO_ANSWER);
    firstSignIn = await signIn();
    markerAfterTheFirst = browser.store.peek(SIGN_OUT_OWED_KEY);

    // A second one is in the air.
    const held = heldAnswer();
    server.when('POST', VERIFY, () => held.answer);
    const second = signIn();
    await flush();
    whileTheSecondIsInTheAir.outcome = await api.settleOwedSignOut();
    await flush();
    whileTheSecondIsInTheAir.signOutCalls = server.callsTo(LOGOUT).length;

    // It gets no answer either.
    held.give(NO_ANSWER);
    secondSignIn = await second;

    whenBothAreOver.outcome = await api.settleOwedSignOut();
    whenBothAreOver.signOutCalls = server.callsTo(LOGOUT).length;
    whenBothAreOver.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
  });

  it('a sign-in call that got no answer leaves the marker set', () => {
    assert.equal(firstSignIn, 'failed');
    assert.equal(markerAfterTheFirst, '1');
  });

  it('the unanswered call came off the count once, not twice: the next call in the air still holds the sign-out back', () => {
    assert.equal(whileTheSecondIsInTheAir.outcome, 'owed');
    assert.equal(whileTheSecondIsInTheAir.signOutCalls, 0);
  });

  it("once the unanswered calls are over, the owed sign-out is paid: the server is called and the answer is 'told'", () => {
    assert.equal(secondSignIn, 'failed');
    assert.equal(whenBothAreOver.outcome, 'told');
    assert.equal(whenBothAreOver.signOutCalls, 1);
    assert.equal(whenBothAreOver.marker, null);
  });
});
