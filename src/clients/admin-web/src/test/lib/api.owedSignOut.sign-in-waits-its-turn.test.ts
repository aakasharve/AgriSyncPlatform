// Rule: a sign-in call made while an owed sign-out is being settled does not leave until that
// settling has finished: the server sees the sign-out call answered before the sign-in call
// arrives. (The other order would let the sign-out's answer take away the cookie the sign-in
// had just been given.)
//
// The sign-in here is then accepted, which also shows the rule about an accepted sign-in on a
// page that had been told: a later settleOwedSignOut() answers 'none' with no sign-out call.
// What a page has been told it keeps for the page load, so this scenario has a file to itself.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, heldAnswer, ok } from '../support/server';
import { MINUTE, NOON, PERSON, SIGN_OUT_OWED_KEY, at } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';
const LOGIN = '/user/auth/login';

describe('a sign-in call made while an owed sign-out is being settled', () => {
  /** The sign-out call is in the air; the sign-in has not been asked for yet. */
  let reachedTheServerBeforeTheSignIn = ['not seen'];
  /** The sign-in has been asked for; the sign-out call is still in the air. */
  let reachedTheServerWhileSettling = ['not seen'];
  /** Whether the server had answered the sign-out call when the sign-in call arrived. */
  let signOutAnsweredWhenTheSignInArrived: boolean | null = null;
  let settled = 'not run';
  let signInStatus = -1;
  let settledLater = 'not run';
  let markerAtTheEnd: string | null = 'not seen';

  before(async () => {
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    const heldSignOut = heldAnswer();
    let signOutAnswered = false;
    server.when('POST', LOGOUT, () => heldSignOut.answer);
    server.when('POST', LOGIN, () => {
      signOutAnsweredWhenTheSignInArrived = signOutAnswered;
      return ok({
        userId: PERSON,
        accessToken: 'token-of-the-new-sign-in',
        expiresAtUtc: at(NOON + 15 * MINUTE),
      });
    });
    const { api } = await loadConsole(server);

    const settling = api.settleOwedSignOut();
    await flush();
    reachedTheServerBeforeTheSignIn = server.log();

    const signingIn = api.adminApi.post(LOGIN, { phone: '9999999999', password: 'right' });
    await flush();
    reachedTheServerWhileSettling = server.log();

    signOutAnswered = true;
    heldSignOut.give(ok());
    settled = await settling;
    signInStatus = (await signingIn).status;

    settledLater = await api.settleOwedSignOut();
    markerAtTheEnd = browser.store.peek(SIGN_OUT_OWED_KEY);
  });

  it('the sign-out call is in the air first', () => {
    assert.deepEqual(reachedTheServerBeforeTheSignIn, [`POST ${LOGOUT}`]);
  });

  it('the sign-in call does not leave while the sign-out is being settled', () => {
    assert.deepEqual(reachedTheServerWhileSettling, [`POST ${LOGOUT}`]);
  });

  it('the server sees the sign-out call answered before the sign-in call arrives', () => {
    assert.equal(signOutAnsweredWhenTheSignInArrived, true);
    assert.deepEqual(server.log().slice(0, 2), [`POST ${LOGOUT}`, `POST ${LOGIN}`]);
  });

  it("the settling ends with 'told', and the sign-in call is then answered as usual", () => {
    assert.equal(settled, 'told');
    assert.equal(signInStatus, 200);
  });

  it("after the accepted sign-in, a later settleOwedSignOut() answers 'none' with no sign-out call", () => {
    assert.equal(settledLater, 'none');
    assert.equal(markerAtTheEnd, null);
    assert.deepEqual(server.log(), [`POST ${LOGOUT}`, `POST ${LOGIN}`], 'one sign-out call in all');
  });
});
