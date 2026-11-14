// Rule: while the page is ending a session (an endSession(...) has begun), settleOwedSignOut()
// answers 'owed' and makes no call of its own. Here the console ends the session after 12 hours
// and is itself telling the server just then. This ends the session: a page load to itself.

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

describe("paying an owed sign-out while the console is ending the session with 'max-age'", () => {
  /** The console's own sign-out call is in the air. */
  const whileEnding = {
    signOutCallsBefore: -1,
    outcome: 'not run',
    signOutCallsAfter: -1,
    marker: 'not seen' as string | null,
  };
  const whenEnded = { signOutCalls: -1, marker: 'not seen' as string | null, opened: ['not seen'] };

  before(async () => {
    keepSession(browser.store, sessionAt(NOON, { token: 'token-of-the-person' }));
    // The first sign-out call (the console's own) waits for its answer. Any further one would be
    // answered at once, so a wrong second call shows up as a plain failure, not as a stuck test.
    const held = heldAnswer();
    server.when('POST', LOGOUT, () => (server.callsTo(LOGOUT).length === 1 ? held.answer : ok()));
    const { api } = await loadConsole(server);

    const ending = api.endSession('max-age');
    await flush();
    whileEnding.signOutCallsBefore = server.callsTo(LOGOUT).length;
    whileEnding.outcome = await api.settleOwedSignOut();
    await flush();
    whileEnding.signOutCallsAfter = server.callsTo(LOGOUT).length;
    whileEnding.marker = browser.store.peek(SIGN_OUT_OWED_KEY);

    held.give(ok());
    await ending;
    whenEnded.signOutCalls = server.callsTo(LOGOUT).length;
    whenEnded.marker = browser.store.peek(SIGN_OUT_OWED_KEY);
    whenEnded.opened = [...browser.opened];
  });

  it("answers 'owed', and the marker stays", () => {
    assert.equal(whileEnding.outcome, 'owed');
    assert.equal(whileEnding.marker, '1');
  });

  it("makes no call of its own: the console's own sign-out call is the only one", () => {
    assert.equal(whileEnding.signOutCallsBefore, 1, "the console's own call is in the air");
    assert.equal(whileEnding.signOutCallsAfter, 1);
    assert.equal(whenEnded.signOutCalls, 1, 'and in all');
  });

  it('the end of the session itself then finishes as usual', () => {
    assert.equal(whenEnded.marker, null);
    assert.deepEqual(whenEnded.opened, ['/login?signedOut=max-age']);
  });
});
