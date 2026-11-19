// Rule: a 401 on a data route causes one renewal and one re-send; a second 401 is not re-sent
// again. (What follows a second refusal may end the session, so this has a page load to itself.)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAxiosError } from 'axios';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, ok, status } from '../support/server';
import { NOON, keepSession, renewedAt, sessionAt } from '../support/session';

const browser = openBrowser();
const server = new FakeServer().install();

const DATA = '/admin/reports/today';
const REFRESH = '/user/auth/refresh';

describe('a data route that answers 401 again after the token was renewed', () => {
  let failure: unknown = null;

  before(async () => {
    setClock(NOON);
    keepSession(browser.store, sessionAt(NOON, { token: 'token-refused' }));
    server.when('GET', DATA, status(401));
    server.when('POST', REFRESH, ok(renewedAt(NOON, 'token-new')));
    const { api } = await loadConsole(server);

    failure = await api.adminApi.get(DATA).then(
      () => null,
      (reason: unknown) => reason,
    );
  });

  after(() => {
    restoreClock();
  });

  it('is renewed for once', () => {
    assert.equal(server.callsTo(REFRESH).length, 1);
  });

  it('is sent twice in all: the first time, and once more with the new token', () => {
    assert.deepEqual(
      server.callsTo(DATA).map((call) => call.authorization),
      ['Bearer token-refused', 'Bearer token-new'],
    );
  });

  it('is not re-sent again after the second 401: the caller gets the refusal', () => {
    assert.ok(isAxiosError(failure), 'the request fails');
    assert.equal(failure.response?.status, 401);
    assert.deepEqual(server.log(), [`GET ${DATA}`, `POST ${REFRESH}`, `GET ${DATA}`]);
  });
});
