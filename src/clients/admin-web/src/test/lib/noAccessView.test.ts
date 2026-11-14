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
