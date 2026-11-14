// Rules: what the console's HTTP client does around a data request. None of the scenarios in
// this file ends the session; each of those has a file (a page load) to itself.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAxiosError } from 'axios';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import {
  FakeServer,
  NO_ANSWER,
  httpError,
  noAnswerError,
  ok,
  status,
  stoppedError,
  type Answer,
} from '../support/server';
import {
  HOUR,
  MINUTE,
  NOON,
  SECOND,
  keepSession,
  keptSession,
  renewedAt,
  sessionAt,
} from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const DATA = '/admin/reports/today';
const REFRESH = '/user/auth/refresh';
const LOGOUT = '/user/auth/logout';

let testsStarted = 0;

/**
 * Sets the clock for one test and gives back its "now". Each test happens an hour after the one
 * before: the page remembers when it last renewed a token, and that must lie well in the past
 * for the next test, as it would after an hour of use.
 */
function startTheClock(): number {
  testsStarted += 1;
  const now = NOON + testsStarted * HOUR;
  setClock(now);
  return now;
}

/** What a failed request was refused with, or null when the error carries no answer. */
function statusOf(err: unknown): number | null {
  return isAxiosError(err) ? (err.response?.status ?? null) : null;
}

function assertNobodyWasSignedOut(tokenStillStored: string): void {
  assert.equal(keptSession(browser.store)?.accessToken, tokenStillStored, 'the session is kept');
  assert.deepEqual(browser.opened, [], 'the login page is not opened');
  assert.equal(server.callsTo(LOGOUT).length, 0, 'the server is not told of any sign-out');
}

beforeEach(() => {
  browser.store.wipe();
  server.reset();
  browser.opened.length = 0;
});

afterEach(() => {
  restoreClock();
});

describe('a data request with a fresh token', () => {
  it('carries Authorization: Bearer <token> and makes no renewal call', async () => {
    const now = startTheClock();
    const { api } = await loadConsole(server);
    keepSession(browser.store, sessionAt(now, { token: 'token-fresh', tokenLeftMs: 10 * MINUTE }));
    server.when('GET', DATA, ok({ rows: 3 }));
    server.when('POST', REFRESH, ok(renewedAt(now)));

    const answer = await api.adminApi.get(DATA);

    assert.deepEqual(answer.data, { rows: 3 });
    assert.deepEqual(server.log(), [`GET ${DATA}`]);
    assert.equal(server.calls[0].authorization, 'Bearer token-fresh');
  });

  it('goes out as usual one millisecond before the session is 12 hours old', async () => {
    const now = startTheClock();
    const { api } = await loadConsole(server);
    keepSession(
      browser.store,
      sessionAt(now, { token: 'token-fresh', signedInAgoMs: 12 * HOUR - 1 }),
    );
    server.when('GET', DATA, ok({ rows: 3 }));

    await api.adminApi.get(DATA);

    assert.deepEqual(server.log(), [`GET ${DATA}`]);
    assert.equal(server.calls[0].authorization, 'Bearer token-fresh');
    assertNobodyWasSignedOut('token-fresh');
  });
});

describe('a data request whose token has a minute or less left', () => {
  for (const [what, tokenLeftMs] of [
    ['exactly a minute left', MINUTE],
    ['thirty seconds left', 30 * SECOND],
    ['already run out', -5 * MINUTE],
  ] as const) {
    it(`${what}: exactly one renewal call first, then the request with the NEW token`, async () => {
      const now = startTheClock();
      const { api } = await loadConsole(server);
      keepSession(browser.store, sessionAt(now, { token: 'token-old', tokenLeftMs }));
      server.when('POST', REFRESH, ok(renewedAt(now, 'token-new')));
      server.when('GET', DATA, ok({ rows: 3 }));

      const answer = await api.adminApi.get(DATA);

      assert.deepEqual(answer.data, { rows: 3 });
      assert.deepEqual(server.log(), [`POST ${REFRESH}`, `GET ${DATA}`]);
      assert.equal(server.callsTo(DATA)[0].authorization, 'Bearer token-new');
      assert.equal(keptSession(browser.store)?.accessToken, 'token-new');
    });
  }

  it('two data requests at once share one renewal call', async () => {
    const now = startTheClock();
    const { api } = await loadConsole(server);
    keepSession(browser.store, sessionAt(now, { token: 'token-old', tokenLeftMs: 30 * SECOND }));
    server.when('POST', REFRESH, ok(renewedAt(now, 'token-new')));
    server.when('GET', DATA, ok({ rows: 3 }));
    server.when('GET', '/admin/farms', ok({ rows: 8 }));

    await Promise.all([api.adminApi.get(DATA), api.adminApi.get('/admin/farms')]);

    assert.equal(server.callsTo(REFRESH).length, 1);
    assert.equal(server.callsTo(DATA)[0].authorization, 'Bearer token-new');
    assert.equal(server.callsTo('/admin/farms')[0].authorization, 'Bearer token-new');
  });
});

describe('a 401 on a data route', () => {
  it('causes one renewal and one re-send with the new token', async () => {
    const now = startTheClock();
    const { api } = await loadConsole(server);
    keepSession(browser.store, sessionAt(now, { token: 'token-refused', tokenLeftMs: 10 * MINUTE }));
    server.when('GET', DATA, (call) =>
      call.authorization === 'Bearer token-new' ? ok({ rows: 3 }) : status(401),
    );
    server.when('POST', REFRESH, ok(renewedAt(now, 'token-new')));

    const answer = await api.adminApi.get(DATA);

    assert.deepEqual(answer.data, { rows: 3 });
    assert.deepEqual(server.log(), [`GET ${DATA}`, `POST ${REFRESH}`, `GET ${DATA}`]);
    assert.deepEqual(
      server.callsTo(DATA).map((call) => call.authorization),
      ['Bearer token-refused', 'Bearer token-new'],
    );
    assertNobodyWasSignedOut('token-new');
  });
});

describe('a 401 from a /user/auth/ route', () => {
  it('on the login page, with nobody signed in: no renewal, not re-sent, handed back as it is', async () => {
    startTheClock();
    const { api } = await loadConsole(server);
    server.when('POST', '/user/auth/login', status(401));
    server.when('POST', REFRESH, ok({}));

    const err: unknown = await api.adminApi
      .post('/user/auth/login', { phone: '9999999999', password: 'wrong' })
      .then(() => null, (reason: unknown) => reason);

    assert.equal(statusOf(err), 401);
    assert.deepEqual(server.log(), ['POST /user/auth/login']);
    assert.deepEqual(browser.opened, []);
  });

  it('with somebody signed in: no renewal, not re-sent, and nobody is signed out', async () => {
    const now = startTheClock();
    const { api } = await loadConsole(server);
    keepSession(browser.store, sessionAt(now, { token: 'token-fresh' }));
    server.when('POST', '/user/auth/verify-otp', status(401, { error: 'otp.mismatch' }));
    server.when('POST', REFRESH, ok(renewedAt(now, 'token-new')));

    const err: unknown = await api.adminApi
      .post('/user/auth/verify-otp', { phone: '9999999999', otp: '000000' })
      .then(() => null, (reason: unknown) => reason);

    assert.equal(statusOf(err), 401);
    assert.deepEqual(server.log(), ['POST /user/auth/verify-otp']);
    assertNobodyWasSignedOut('token-fresh');
  });
});

describe('a 403 with code auth.device_unconfirmed', () => {
  it('starts no renewal, is not re-sent, and signs nobody out', async () => {
    const now = startTheClock();
    const { api } = await loadConsole(server);
    keepSession(browser.store, sessionAt(now, { token: 'token-fresh' }));
    server.when(
      'GET',
      DATA,
      status(403, {
        code: 'auth.device_unconfirmed',
        error: 'auth.device_unconfirmed',
        message: 'This sign-in is waiting for an answer.',
      }),
    );
    server.when('POST', REFRESH, ok(renewedAt(now, 'token-new')));

    const err: unknown = await api.adminApi.get(DATA).then(() => null, (reason: unknown) => reason);

    assert.equal(statusOf(err), 403);
    assert.deepEqual(server.log(), [`GET ${DATA}`]);
    assertNobodyWasSignedOut('token-fresh');
  });
});

describe('a renewal that gets no verdict keeps the session', () => {
  const noVerdicts: Array<[what: string, answer: Answer]> = [
    ['no answer', NO_ANSWER],
    ['429', status(429)],
    ['503', status(503)],
  ];

  for (const [what, answer] of noVerdicts) {
    it(`${what}: the request goes out with the old token when it still has time left`, async () => {
      const now = startTheClock();
      const { api } = await loadConsole(server);
      keepSession(browser.store, sessionAt(now, { token: 'token-old', tokenLeftMs: 30 * SECOND }));
      server.when('POST', REFRESH, answer);
      server.when('GET', DATA, ok({ rows: 3 }));

      const response = await api.adminApi.get(DATA);

      assert.deepEqual(response.data, { rows: 3 });
      assert.equal(server.callsTo(REFRESH).length, 1);
      assert.equal(server.callsTo(DATA)[0].authorization, 'Bearer token-old');
      assertNobodyWasSignedOut('token-old');
    });

    it(`${what}: the request fails, and nobody is signed out, when the old token has no time left`, async () => {
      const now = startTheClock();
      const { api } = await loadConsole(server);
      keepSession(browser.store, sessionAt(now, { token: 'token-old', tokenLeftMs: -5 * SECOND }));
      server.when('POST', REFRESH, answer);
      server.when('GET', DATA, ok({ rows: 3 }));

      await assert.rejects(api.adminApi.get(DATA));

      assertNobodyWasSignedOut('token-old');
    });
  }
});

describe('whether a failed request got no verdict from the server', () => {
  it('true for no answer at all', async () => {
    const { api } = await loadConsole(server);
    assert.equal(api.gotNoVerdict(noAnswerError()), true);
  });

  for (const code of [429, 500, 502, 503, 504]) {
    it(`true for ${code}`, async () => {
      const { api } = await loadConsole(server);
      assert.equal(api.gotNoVerdict(httpError(code)), true);
    });
  }

  for (const code of [401, 403, 404]) {
    it(`false for ${code}`, async () => {
      const { api } = await loadConsole(server);
      assert.equal(api.gotNoVerdict(httpError(code)), false);
    });
  }

  it('false for a request the console itself stopped', async () => {
    const { api } = await loadConsole(server);
    assert.equal(api.gotNoVerdict(stoppedError()), false);
  });

  it('judges the errors its own HTTP client hands back the same way', async () => {
    const now = startTheClock();
    const { api } = await loadConsole(server);
    keepSession(browser.store, sessionAt(now, { token: 'token-fresh' }));
    const failure = (reason: unknown) => reason;

    server.when('GET', DATA, NO_ANSWER);
    assert.equal(api.gotNoVerdict(await api.adminApi.get(DATA).then(() => null, failure)), true);

    server.when('GET', DATA, status(503));
    assert.equal(api.gotNoVerdict(await api.adminApi.get(DATA).then(() => null, failure)), true);

    server.when('GET', DATA, status(404));
    assert.equal(api.gotNoVerdict(await api.adminApi.get(DATA).then(() => null, failure)), false);

    const stopped = new AbortController();
    stopped.abort();
    const cutOff = await api.adminApi.get(DATA, { signal: stopped.signal }).then(() => null, failure);
    assert.notEqual(cutOff, null);
    assert.equal(api.gotNoVerdict(cutOff), false);
  });
});

describe('reading why the console signed somebody out', () => {
  it('reads max-age', async () => {
    const { api } = await loadConsole(server);
    assert.equal(api.readSessionEndReason('?signedOut=max-age'), 'max-age');
  });

  it('reads ended', async () => {
    const { api } = await loadConsole(server);
    assert.equal(api.readSessionEndReason('?signedOut=ended'), 'ended');
  });

  it('reads it among other things in the address', async () => {
    const { api } = await loadConsole(server);
    assert.equal(api.readSessionEndReason('?org=7&signedOut=ended'), 'ended');
  });

  for (const search of ['', '?', '?signedOut=', '?signedOut=1', '?signedOut=Ended', '?signedout=ended', '?max-age']) {
    it(`gives null for anything else: "${search}"`, async () => {
      const { api } = await loadConsole(server);
      assert.equal(api.readSessionEndReason(search), null);
    });
  }
});
