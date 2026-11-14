// Rule: the count of sign-in calls in the air comes down exactly once per call, answered or
// failed. Here TWO sign-in calls are in the air at once and both are answered: afterwards a
// settleOwedSignOut() with the marker set does call the server (it is not stuck on 'owed').
//
// The calls go to /user/auth/start-otp, whose 2xx leaves the marker alone. The scenario ends
// with the server told, which a page keeps for the page load: a file to itself.

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
const START = '/user/auth/start-otp';

describe('an owed sign-out on a login page with two sign-in calls in the air at once', () => {
  const withBothInTheAir = { signInCalls: -1, outcome: 'not run', signOutCalls: -1 };
  const withOneAnswered = { outcome: 'not run', signOutCalls: -1, marker: 'not seen' as string | null };
  const withBothAnswered = { outcome: 'not run', signOutCalls: -1, marker: 'not seen' as string | null };
  let answers = ['not run', 'not run'];

  before(async () => {
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    server.when('POST', LOGOUT, ok());
    const first = heldAnswer();
    const second = heldAnswer();
    const waiting = [first.answer, second.answer];
    server.when('POST', START, () => waiting.shift() ?? NO_ANSWER);
    const { api } = await loadConsole(server);
    const sendCode = () =>
      api.adminApi.post(START, { phone: '9999999999' }).then(
        () => 'answered',
        () => 'failed',
      );

    const firstCall = sendCode();
    const secondCall = sendCode();
    await flush();
    withBothInTheAir.signInCalls = server.callsTo(START).length;
    withBothInTheAir.outcome = await api.settleOwedSignOut();
    await flush();
    withBothInTheAir.signOutCalls = server.callsTo(LOGOUT).length;

    first.give(ok({ sent: true }));
    const firstAnswer = await firstCall;
    withOneAnswered.outcome = await api.settleOwedSignOut();
    await flush();
    withOneAnswered.signOutCalls = server.callsTo(LOGOUT).length;
    withOneAnswered.marker = browser.store.peek(SIGN_OUT_OWED_KEY);

    second.give(ok({ sent: true }));
    answers = [firstAnswer, await secondCall];
    withBothAnswered.outcome = await api.settleOwedSignOut();
    withBothAnswered.signOutCalls = server.callsTo(LOGOUT).length;
    withBothAnswered.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
  });

  it('with both in the air: owed, and no sign-out call', () => {
    assert.equal(withBothInTheAir.signInCalls, 2);
    assert.equal(withBothInTheAir.outcome, 'owed');
    assert.equal(withBothInTheAir.signOutCalls, 0);
  });

  it('with one answered and one still in the air: still owed, and no sign-out call', () => {
    assert.equal(withOneAnswered.outcome, 'owed');
    assert.equal(withOneAnswered.signOutCalls, 0);
  });

  it('a 2xx from /user/auth/start-otp leaves the marker alone', () => {
    assert.equal(withOneAnswered.marker, '1');
  });

  it("with both answered, the owed sign-out is paid: the server is called and the answer is 'told'", () => {
    assert.deepEqual(answers, ['answered', 'answered']);
    assert.equal(withBothAnswered.outcome, 'told');
    assert.equal(withBothAnswered.signOutCalls, 1);
    assert.equal(withBothAnswered.marker, null);
  });
});
