// Rules: what the no-access page may say. A reason counts only for the account it was given for.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const PERSON_A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSON_B = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function load() {
  return import('@/lib/noAccessView');
}

describe('the no-access page gives no reason', () => {
  it('when nothing came with the navigation', async () => {
    const { noAccessView } = await load();
    assert.equal(noAccessView(undefined, PERSON_A), 'no-reason');
    assert.equal(noAccessView(null, PERSON_A), 'no-reason');
  });

  for (const state of ['not-on-team', 42, true]) {
    it(`when what came with the navigation is not an object: ${JSON.stringify(state)}`, async () => {
      const { noAccessView } = await load();
      assert.equal(noAccessView(state, PERSON_A), 'no-reason');
    });
  }

  it('when the state names no account', async () => {
    const { noAccessView } = await load();
    assert.equal(noAccessView({ reason: 'not-on-team' }, PERSON_A), 'no-reason');
    assert.equal(noAccessView({ module: 'operations' }, PERSON_A), 'no-reason');
    assert.equal(noAccessView({}, PERSON_A), 'no-reason');
  });

  it("when person A's \"not on the team\" entry is reached by person B", async () => {
    const { noAccessView } = await load();
    const leftByPersonA = { reason: 'not-on-team', account: PERSON_A };
    assert.equal(noAccessView(leftByPersonA, PERSON_B), 'no-reason');
  });

  it("when person A's closed-page entry is reached by person B", async () => {
    const { noAccessView } = await load();
    const leftByPersonA = { module: 'operations', account: PERSON_A };
    assert.equal(noAccessView(leftByPersonA, PERSON_B), 'no-reason');
  });

  it('when nobody is signed in', async () => {
    const { noAccessView } = await load();
    assert.equal(noAccessView({ reason: 'not-on-team', account: PERSON_A }, null), 'no-reason');
    assert.equal(noAccessView({ module: 'operations', account: PERSON_A }, null), 'no-reason');
  });

  it('when the account matches but the state carries neither a reason nor a module', async () => {
    const { noAccessView } = await load();
    assert.equal(noAccessView({ account: PERSON_A }, PERSON_A), 'no-reason');
    assert.equal(noAccessView({ account: PERSON_A, module: '' }, PERSON_A), 'no-reason');
    assert.equal(noAccessView({ account: PERSON_A, from: '/ops/farms' }, PERSON_A), 'no-reason');
  });
});

describe('the no-access page gives a reason to the account it is true for', () => {
  it('says "not on the team" for a matching account with that reason', async () => {
    const { noAccessView } = await load();
    assert.equal(noAccessView({ reason: 'not-on-team', account: PERSON_A }, PERSON_A), 'not-on-team');
  });

  it('still says "not on the team" when that entry also names a module', async () => {
    const { noAccessView } = await load();
    const state = { reason: 'not-on-team', module: 'operations', account: PERSON_A };
    assert.equal(noAccessView(state, PERSON_A), 'not-on-team');
  });

  it('says "this one page is closed" for a matching account with a module and no reason', async () => {
    const { noAccessView } = await load();
    assert.equal(noAccessView({ module: 'operations', account: PERSON_A }, PERSON_A), 'one-page');
  });
});

// Rules: the name of a sign-in (`signInKey`): who, and since when. The gates put it into the
// state as `account`, and the page reads the state against the name of the sign-in it is in.

const MORNING = '2026-06-15T06:00:00.000Z';
const AFTERNOON = '2026-06-15T13:30:00.000Z';

/** A session of this person, signed in at this moment, with whatever access token it has now. */
function sessionOf(userId: string, signedInAtUtc: string, accessToken: string = 'token-1') {
  return {
    accessToken,
    refreshToken: null,
    userId,
    expiresAtUtc: accessToken === 'token-1' ? '2026-06-15T06:15:00.000Z' : '2026-06-15T09:45:00.000Z',
    signedInAtUtc,
  };
}

describe('the name of a sign-in', () => {
  it('is null when there is no session', async () => {
    const { signInKey } = await load();
    assert.equal(signInKey(null), null);
    assert.equal(signInKey(undefined), null);
  });

  it('is a name, not nothing, for a session', async () => {
    const { signInKey } = await load();
    const key = signInKey(sessionOf(PERSON_A, MORNING));
    assert.equal(typeof key, 'string');
    assert.notEqual(key, '');
  });

  it('is the same for two sessions of the same person with the same sign-in time: a renewal keeps it', async () => {
    const { signInKey } = await load();
    const asSignedIn = sessionOf(PERSON_A, MORNING, 'token-1');
    const afterARenewal = sessionOf(PERSON_A, MORNING, 'token-renewed');
    assert.notEqual(afterARenewal.expiresAtUtc, asSignedIn.expiresAtUtc);

    assert.equal(signInKey(afterARenewal), signInKey(asSignedIn));
  });

  it('is different for the same person with another sign-in time: signed out and in again', async () => {
    const { signInKey } = await load();
    assert.notEqual(
      signInKey(sessionOf(PERSON_A, AFTERNOON)),
      signInKey(sessionOf(PERSON_A, MORNING)),
    );
  });

  it('is different for another person, even one who signed in at the very same moment', async () => {
    const { signInKey } = await load();
    assert.notEqual(signInKey(sessionOf(PERSON_B, MORNING)), signInKey(sessionOf(PERSON_A, MORNING)));
    assert.notEqual(signInKey(sessionOf(PERSON_B, AFTERNOON)), signInKey(sessionOf(PERSON_A, MORNING)));
  });
});

describe('a "not on the team" entry left by one sign-in', () => {
  it('read in the same sign-in: says "not on the team"', async () => {
    const { noAccessView, signInKey } = await load();
    const signIn = sessionOf(PERSON_A, MORNING);
    const left = { reason: 'not-on-team', account: signInKey(signIn) };

    assert.equal(noAccessView(left, signInKey(signIn)), 'not-on-team');
  });

  it('read in the same sign-in after its token was renewed: still says "not on the team"', async () => {
    const { noAccessView, signInKey } = await load();
    const left = { reason: 'not-on-team', account: signInKey(sessionOf(PERSON_A, MORNING, 'token-1')) };
    const afterARenewal = sessionOf(PERSON_A, MORNING, 'token-renewed');

    assert.equal(noAccessView(left, signInKey(afterARenewal)), 'not-on-team');
  });

  it("read in the same person's LATER sign-in: gives no reason", async () => {
    const { noAccessView, signInKey } = await load();
    const left = { reason: 'not-on-team', account: signInKey(sessionOf(PERSON_A, MORNING)) };
    const signedInAgain = sessionOf(PERSON_A, AFTERNOON);

    assert.equal(noAccessView(left, signInKey(signedInAgain)), 'no-reason');
  });

  it("read in another person's sign-in: gives no reason", async () => {
    const { noAccessView, signInKey } = await load();
    const left = { reason: 'not-on-team', account: signInKey(sessionOf(PERSON_A, MORNING)) };

    assert.equal(noAccessView(left, signInKey(sessionOf(PERSON_B, MORNING))), 'no-reason');
    assert.equal(noAccessView(left, signInKey(sessionOf(PERSON_B, AFTERNOON))), 'no-reason');
  });

  it('read with nobody signed in: gives no reason', async () => {
    const { noAccessView, signInKey } = await load();
    const left = { reason: 'not-on-team', account: signInKey(sessionOf(PERSON_A, MORNING)) };

    assert.equal(noAccessView(left, signInKey(null)), 'no-reason');
  });
});
