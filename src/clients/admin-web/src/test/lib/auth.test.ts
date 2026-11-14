// Rules: session age, and what the browser's store gives back as "the stored session".

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installStore } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { HOUR, MINUTE, NOON, SECOND, SESSION_KEY, at, type StoredSession } from '../support/session';

const store = installStore();

const TWELVE_HOURS = 12 * HOUR;

/** Signed in at NOON, with an access token that runs out ten minutes after NOON. */
function session(parts: Partial<StoredSession> = {}): StoredSession {
  return {
    accessToken: 'token-1',
    refreshToken: null,
    userId: 'user-1',
    expiresAtUtc: at(NOON + 10 * MINUTE),
    signedInAtUtc: at(NOON),
    ...parts,
  };
}

/** The session as text, with some of its fields taken out or replaced. */
function sessionText(changes: Record<string, unknown>, without: string[] = []): string {
  const fields: Record<string, unknown> = { ...session(), ...changes };
  for (const name of without) delete fields[name];
  return JSON.stringify(fields);
}

beforeEach(() => {
  store.wipe();
});

afterEach(() => {
  restoreClock();
});

describe('how long a sign-in lasts', () => {
  it('lasts 12 hours', async () => {
    const { MAX_SESSION_HOURS } = await import('@/lib/auth');
    assert.equal(MAX_SESSION_HOURS, 12);
  });

  it('is not over age one millisecond before sign-in time plus 12 hours', async () => {
    const { isSessionOverAge, msUntilSessionOverAge } = await import('@/lib/auth');
    const justBefore = NOON + TWELVE_HOURS - 1;
    assert.equal(isSessionOverAge(session(), justBefore), false);
    assert.equal(msUntilSessionOverAge(session(), justBefore), 1);
  });

  it('is over age at sign-in time plus 12 hours exactly', async () => {
    const { isSessionOverAge } = await import('@/lib/auth');
    assert.equal(isSessionOverAge(session(), NOON + TWELVE_HOURS), true);
  });

  it('stays over age after that moment', async () => {
    const { isSessionOverAge } = await import('@/lib/auth');
    assert.equal(isSessionOverAge(session(), NOON + TWELVE_HOURS + 1), true);
    assert.equal(isSessionOverAge(session(), NOON + 30 * HOUR), true);
  });

  it('has zero or less time left from that moment on', async () => {
    const { msUntilSessionOverAge } = await import('@/lib/auth');
    assert.equal(msUntilSessionOverAge(session(), NOON + TWELVE_HOURS), 0);
    assert.ok(msUntilSessionOverAge(session(), NOON + TWELVE_HOURS + 1) < 0);
    assert.ok(msUntilSessionOverAge(session(), NOON + 30 * HOUR) < 0);
  });

  it('reads the clock itself when no time is passed in', async () => {
    const { isSessionOverAge } = await import('@/lib/auth');
    setClock(NOON + TWELVE_HOURS - 1);
    assert.equal(isSessionOverAge(session()), false);
    setClock(NOON + TWELVE_HOURS);
    assert.equal(isSessionOverAge(session()), true);
  });
});

describe('whether the access token runs out within a given time', () => {
  it('is true for a token that has already run out', async () => {
    const { accessTokenExpiresWithin } = await import('@/lib/auth');
    const expired = session({ expiresAtUtc: at(NOON - SECOND) });
    assert.equal(accessTokenExpiresWithin(expired, 0, NOON), true);
    assert.equal(accessTokenExpiresWithin(expired, MINUTE, NOON), true);
  });

  it('is true for a token that runs out inside the window', async () => {
    const { accessTokenExpiresWithin } = await import('@/lib/auth');
    const thirtySecondsLeft = session({ expiresAtUtc: at(NOON + 30 * SECOND) });
    assert.equal(accessTokenExpiresWithin(thirtySecondsLeft, MINUTE, NOON), true);
  });

  it('is true for an expiry that cannot be read', async () => {
    const { accessTokenExpiresWithin } = await import('@/lib/auth');
    assert.equal(accessTokenExpiresWithin(session({ expiresAtUtc: 'next week' }), 0, NOON), true);
    assert.equal(accessTokenExpiresWithin(session({ expiresAtUtc: '31/02/2026' }), MINUTE, NOON), true);
  });

  it('is false for a token that runs out after the window', async () => {
    const { accessTokenExpiresWithin } = await import('@/lib/auth');
    const tenMinutesLeft = session({ expiresAtUtc: at(NOON + 10 * MINUTE) });
    assert.equal(accessTokenExpiresWithin(tenMinutesLeft, MINUTE, NOON), false);
  });
});

describe('the stored session', () => {
  it('is kept in the browser store under admin.session.v1', async () => {
    const { authStore } = await import('@/lib/auth');
    assert.equal(SESSION_KEY, 'admin.session.v1');

    authStore.set(session());
    assert.deepEqual(JSON.parse(store.peek('admin.session.v1') ?? 'null'), session());

    store.wipe();
    store.put('admin.session.v1', JSON.stringify(session({ accessToken: 'token-put-by-hand' })));
    assert.equal(authStore.get()?.accessToken, 'token-put-by-hand');

    authStore.clear();
    assert.equal(store.peek('admin.session.v1'), null);
  });

  it('is returned even when its access token has expired: an expired token is not a sign-out', async () => {
    const { authStore } = await import('@/lib/auth');
    setClock(NOON + 3 * HOUR);
    const expiredLongAgo = session({ expiresAtUtc: at(NOON + 10 * MINUTE) });
    store.put(SESSION_KEY, JSON.stringify(expiredLongAgo));

    assert.deepEqual(authStore.get(), expiredLongAgo);
  });

  it('is null when nothing is stored', async () => {
    const { authStore } = await import('@/lib/auth');
    assert.equal(authStore.get(), null);
  });

  for (const broken of ['{"accessToken":"token-1","userId":', 'this is not a session', '']) {
    it(`is null when the stored text is broken: ${JSON.stringify(broken)}`, async () => {
      const { authStore } = await import('@/lib/auth');
      store.put(SESSION_KEY, broken);
      assert.equal(authStore.get(), null);
    });
  }

  const needed: Array<[field: string, plainName: string]> = [
    ['accessToken', 'access token'],
    ['userId', 'user id'],
    ['expiresAtUtc', 'expiry'],
  ];
  for (const [field, plainName] of needed) {
    it(`is null when the stored session has no ${plainName} (the field is missing)`, async () => {
      const { authStore } = await import('@/lib/auth');
      store.put(SESSION_KEY, sessionText({}, [field]));
      assert.equal(authStore.get(), null);
    });

    it(`is null when the stored session has no ${plainName} (the field is null)`, async () => {
      const { authStore } = await import('@/lib/auth');
      store.put(SESSION_KEY, sessionText({ [field]: null }));
      assert.equal(authStore.get(), null);
    });

    it(`is null when the stored session has no ${plainName} (the field is blank)`, async () => {
      const { authStore } = await import('@/lib/auth');
      store.put(SESSION_KEY, sessionText({ [field]: '' }));
      assert.equal(authStore.get(), null);
    });
  }

  it('gives a session stored with no sign-in time the current time, once, and writes it back', async () => {
    const { authStore } = await import('@/lib/auth');
    store.put(SESSION_KEY, sessionText({}, ['signedInAtUtc']));

    setClock(NOON + HOUR);
    const first = authStore.get();
    assert.equal(first?.signedInAtUtc, at(NOON + HOUR));
    assert.equal(first?.accessToken, 'token-1');
    assert.equal(
      (JSON.parse(store.peek(SESSION_KEY) ?? '{}') as StoredSession).signedInAtUtc,
      at(NOON + HOUR),
      'the time is written back into the store',
    );

    setClock(NOON + 5 * HOUR);
    const second = authStore.get();
    assert.equal(second?.signedInAtUtc, at(NOON + HOUR), 'a second read returns the same time');
  });
});
