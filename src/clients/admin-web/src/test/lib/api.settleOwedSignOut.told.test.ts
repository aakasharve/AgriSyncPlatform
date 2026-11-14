// Rule: settleOwedSignOut() with the marker and a server that answers gives 'told' and removes
// the marker. What a page has been told it keeps for the rest of the page load, so this has a
// file to itself.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { loadConsole } from '../support/console';
import { FakeServer, ok } from '../support/server';
import { SIGN_OUT_OWED_KEY } from '../support/session';

const browser = openBrowser({ path: '/login' });
const server = new FakeServer().install();

describe('paying an owed sign-out when the server answers', () => {
  let outcome = 'not run';
  let markerWhenTheServerWasTold: string | null = 'not seen';
  let owedAfterwards: boolean | null = null;

  before(async () => {
    browser.store.put(SIGN_OUT_OWED_KEY, '1');
    server.when('POST', '/user/auth/logout', () => {
      markerWhenTheServerWasTold = browser.store.peek(SIGN_OUT_OWED_KEY);
      return ok();
    });
    const { api } = await loadConsole(server);

    outcome = await api.settleOwedSignOut();
    owedAfterwards = api.isSignOutOwed();
  });

  it("gives 'told'", () => {
    assert.equal(outcome, 'told');
  });

  it('told the server: one POST /user/auth/logout, with credentials', () => {
    assert.deepEqual(server.log(), ['POST /user/auth/logout']);
    assert.equal(server.calls[0].withCredentials, true);
  });

  it('kept the marker until the server had answered', () => {
    assert.equal(markerWhenTheServerWasTold, '1');
  });

  it('removes the marker', () => {
    assert.equal(browser.store.peek(SIGN_OUT_OWED_KEY), null);
    assert.equal(owedAfterwards, false);
  });
});
