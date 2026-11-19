// Rule: while the page is ending a session (a signOut() has begun), settleOwedSignOut() answers
// 'owed' and makes no call of its own. The page is itself telling the server just then.
// This ends the session, so it has a page load to itself.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { flush } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, heldAnswer, ok } from '../support/server';
import { NOON, SIGN_OUT_OWED_KEY, keepSession, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const LOGOUT = '/user/auth/logout';

describe('paying an owed sign-out while the person is being signed out', () => {
  /** The press's own sign-out call is in the air. */
  const whileSigningOut = {
    signOutCallsBefore: -1,
    outcome: 'not run',
    signOutCallsAfter: -1,
    marker: 'not seen' as string | null,
  };
  const whenSignedOut = { signOutCalls: -1, marker: 'not seen' as string | null, opened: ['not seen'] };

  before(async () => {
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-the-person' }));
    // The first sign-out call (the press's own) waits for its answer. Any further one would be
    // answered at once, so a wrong second call shows up as a plain failure, not as a stuck test.
    const held = heldAnswer();
    server.when('POST', LOGOUT, () => (server.callsTo(LOGOUT).length === 1 ? held.answer : ok()));
    const { api } = await loadConsole(server);

    const pressing = api.signOut();
    await flush();
    whileSigningOut.signOutCallsBefore = server.callsTo(LOGOUT).length;
    whileSigningOut.outcome = await api.settleOwedSignOut();
    await flush();
    whileSigningOut.signOutCallsAfter = server.callsTo(LOGOUT).length;
    whileSigningOut.marker = browser.store.peek(SIGN_OUT_OWED_KEY);

    held.give(ok());
    await pressing;
    whenSignedOut.signOutCalls = server.callsTo(LOGOUT).length;
    whenSignedOut.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
    whenSignedOut.opened = [...browser.opened];
  });

  it("answers 'owed', and the marker stays", () => {
    assert.equal(whileSigningOut.outcome, 'owed');
    assert.equal(whileSigningOut.marker, '1');
  });

  it("makes no call of its own: the press's own sign-out call is the only one", () => {
    assert.equal(whileSigningOut.signOutCallsBefore, 1, "the press's own call is in the air");
    assert.equal(whileSigningOut.signOutCallsAfter, 1);
    assert.equal(whenSignedOut.signOutCalls, 1, 'and in all');
  });

  it('the sign-out itself then ends as usual', () => {
    assert.equal(whenSignedOut.marker, null);
    assert.deepEqual(whenSignedOut.opened, ['/login']);
  });
});
