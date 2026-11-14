// Rules: when an access token is renewed ahead of time. Here the token was obtained by signing
// in; the file next to this one covers a token obtained by a renewal.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { FakeServer } from '../support/server';
import { HOUR, MINUTE, NOON, SECOND, at, type StoredSession } from '../support/session';

openBrowser();
new FakeServer().install();

function load() {
  return import('@/lib/sessionRenewal');
}

/** A session at NOON: how long ago the person signed in, and how long the token has left. */
function session(signedInAgoMs: number, tokenLeftMs: number): StoredSession {
  return {
    accessToken: 'token-1',
    refreshToken: null,
    userId: 'user-1',
    expiresAtUtc: at(NOON + tokenLeftMs),
    signedInAtUtc: at(NOON - signedInAgoMs),
  };
}

describe('whether the access token needs renewing before it is used', () => {
  it('yes: exactly a minute left, obtained exactly a minute ago', async () => {
    const { accessTokenNeedsRenewal } = await load();
    assert.equal(accessTokenNeedsRenewal(session(MINUTE, MINUTE), NOON), true);
  });

  it('yes: less than a minute left, obtained hours ago', async () => {
    const { accessTokenNeedsRenewal } = await load();
    assert.equal(accessTokenNeedsRenewal(session(2 * HOUR, 30 * SECOND), NOON), true);
    assert.equal(accessTokenNeedsRenewal(session(2 * HOUR, 1), NOON), true);
  });

  it('yes: already run out, obtained hours ago', async () => {
    const { accessTokenNeedsRenewal } = await load();
    assert.equal(accessTokenNeedsRenewal(session(2 * HOUR, 0), NOON), true);
    assert.equal(accessTokenNeedsRenewal(session(2 * HOUR, -10 * MINUTE), NOON), true);
  });

  it('no: more than a minute left', async () => {
    const { accessTokenNeedsRenewal } = await load();
    assert.equal(accessTokenNeedsRenewal(session(2 * HOUR, MINUTE + 1), NOON), false);
    assert.equal(accessTokenNeedsRenewal(session(2 * HOUR, 10 * MINUTE), NOON), false);
  });

  it('no: obtained under a minute ago, even when it looks about to expire', async () => {
    const { accessTokenNeedsRenewal } = await load();
    assert.equal(accessTokenNeedsRenewal(session(MINUTE - 1, 5 * SECOND), NOON), false);
    assert.equal(accessTokenNeedsRenewal(session(SECOND, MINUTE), NOON), false);
  });

  it('no: obtained under a minute ago, even when it already looks expired', async () => {
    const { accessTokenNeedsRenewal } = await load();
    assert.equal(accessTokenNeedsRenewal(session(MINUTE - 1, -5 * SECOND), NOON), false);
  });
});
