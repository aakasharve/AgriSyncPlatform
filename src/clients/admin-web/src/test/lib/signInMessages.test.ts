// Rules: the sentences of the login page. Every sentence below is written out from the rules;
// none is taken from the code.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../support/browser';
import { restoreClock, setClock } from '../support/clock';
import { loadConsole } from '../support/console';
import { FakeServer, NO_ANSWER, httpError, noAnswerError, status } from '../support/server';
import { HOUR, NOON, at } from '../support/session';

openBrowser({ path: '/login' });
const server = new FakeServer().install();

const UNREACHABLE = 'The server could not be reached. Check your connection and try again.';
const WENT_WRONG = 'Something went wrong. Please try again in a little while.';
const BAD_PHONE = 'That phone number does not look right. Enter a 10-digit mobile number.';
const TOO_MANY = 'Too many tries. Please wait a while, then try again.';

/** A sentence and a code no rule knows, as a server might write them. */
const SERVER_SENTENCE = 'Zebra quota exceeded for tenant 7Q4, retry after 311 heartbeats.';
const SERVER_CODE = 'zebra.quota_7q4';
const SERVER_BODY = { error: SERVER_CODE, message: SERVER_SENTENCE };

const OTHER_STATUSES = [403, 404, 409, 410, 418, 422, 500, 502, 503];

function load() {
  return import('@/lib/signInMessages');
}

beforeEach(() => {
  server.reset();
});

afterEach(() => {
  restoreClock();
});

describe('what the login page opens with after the console signed somebody out', () => {
  it('says the 12-hour sentence for ?signedOut=max-age', async () => {
    const { signedOutNotice } = await load();
    assert.equal(
      signedOutNotice('?signedOut=max-age'),
      'You were signed out after 12 hours. Sign in again.',
    );
  });

  it('says the session-ended sentence for ?signedOut=ended', async () => {
    const { signedOutNotice } = await load();
    assert.equal(signedOutNotice('?signedOut=ended'), 'Your session has ended. Sign in again.');
  });

  for (const search of ['', '?signedOut=', '?signedOut=yes', '?signedOut=MAX-AGE', '?reason=ended']) {
    it(`says nothing for anything else: "${search}"`, async () => {
      const { signedOutNotice } = await load();
      assert.equal(signedOutNotice(search), null);
    });
  }
});

describe('reading a refusal', () => {
  for (const [what, err] of [
    ['a plain error', new Error('boom')],
    ['a piece of text', 'boom'],
    ['nothing', null],
    ['an object that only looks like an answer', { response: { status: 500, data: SERVER_BODY } }],
  ] as const) {
    it(`an error that is not an HTTP error (${what}) is not "unreachable" and has no status`, async () => {
      const { readRefusal } = await load();
      const refusal = readRefusal(err);
      assert.equal(refusal.unreachable, false);
      assert.equal(refusal.status, null);
    });
  }

  it('an HTTP error with no answer is unreachable', async () => {
    const { readRefusal } = await load();
    const refusal = readRefusal(noAnswerError());
    assert.equal(refusal.unreachable, true);
    assert.equal(refusal.status, null);
  });

  it('an HTTP error with an answer carries the status, the code and the trimmed message', async () => {
    const { readRefusal } = await load();
    const refusal = readRefusal(
      httpError(410, { error: 'otp.expired', message: '  That code is too old.  \n' }),
    );
    assert.deepEqual(refusal, {
      status: 410,
      unreachable: false,
      code: 'otp.expired',
      message: 'That code is too old.',
    });
  });

  it('a blank message counts as no message', async () => {
    const { readRefusal } = await load();
    assert.equal(readRefusal(httpError(429, { error: 'rate', message: '   ' })).message, null);
    assert.equal(readRefusal(httpError(429, { error: 'rate', message: '' })).message, null);
    assert.equal(readRefusal(httpError(429, { error: 'rate' })).message, null);
  });

  it('an answer with no body has a status and neither code nor message', async () => {
    const { readRefusal } = await load();
    assert.deepEqual(readRefusal(httpError(401)), {
      status: 401,
      unreachable: false,
      code: null,
      message: null,
    });
  });

  it('reads a refusal that came back through the console\'s own HTTP client', async () => {
    const { readRefusal } = await load();
    const { api } = await loadConsole(server);
    server.when('POST', '/user/auth/verify-otp', status(401, { error: 'otp.mismatch', message: ' No. ' }));

    const err: unknown = await api.adminApi.post('/user/auth/verify-otp', {}).then(
      () => null,
      (reason: unknown) => reason,
    );
    assert.deepEqual(readRefusal(err), {
      status: 401,
      unreachable: false,
      code: 'otp.mismatch',
      message: 'No.',
    });
  });

  it('reads "no answer" that came back through the console\'s own HTTP client', async () => {
    const { readRefusal } = await load();
    const { api } = await loadConsole(server);
    server.when('POST', '/user/auth/send-otp', NO_ANSWER);

    const err: unknown = await api.adminApi.post('/user/auth/send-otp', {}).then(
      () => null,
      (reason: unknown) => reason,
    );
    assert.equal(readRefusal(err).unreachable, true);
  });
});

describe('the password way', () => {
  it('401: the phone number or password is not right', async () => {
    const { readRefusal, passwordRefusalText } = await load();
    assert.equal(
      passwordRefusalText(readRefusal(httpError(401))),
      'The phone number or password is not right.',
    );
  });

  it('unreachable: the server could not be reached', async () => {
    const { readRefusal, passwordRefusalText } = await load();
    assert.equal(passwordRefusalText(readRefusal(noAnswerError())), UNREACHABLE);
  });

  it('400: that phone number does not look right', async () => {
    const { readRefusal, passwordRefusalText } = await load();
    assert.equal(passwordRefusalText(readRefusal(httpError(400, SERVER_BODY))), BAD_PHONE);
  });

  it('429: too many tries, and never the sentence the server sent', async () => {
    const { readRefusal, passwordRefusalText } = await load();
    assert.equal(passwordRefusalText(readRefusal(httpError(429, SERVER_BODY))), TOO_MANY);
    assert.equal(passwordRefusalText(readRefusal(httpError(429))), TOO_MANY);
  });

  for (const code of OTHER_STATUSES) {
    it(`anything else (${code}): something went wrong`, async () => {
      const { readRefusal, passwordRefusalText } = await load();
      assert.equal(passwordRefusalText(readRefusal(httpError(code, SERVER_BODY))), WENT_WRONG);
    });
  }

  it('an error that is no HTTP error at all: something went wrong', async () => {
    const { readRefusal, passwordRefusalText } = await load();
    assert.equal(passwordRefusalText(readRefusal(new Error(SERVER_SENTENCE))), WENT_WRONG);
  });

  for (const code of [400, 401, 429, ...OTHER_STATUSES]) {
    it(`shows nothing the server wrote, whatever the status (${code})`, async () => {
      const { readRefusal, passwordRefusalText } = await load();
      const text = passwordRefusalText(readRefusal(httpError(code, SERVER_BODY)));
      assert.ok(!text.includes(SERVER_SENTENCE), `the server's sentence is shown: ${text}`);
      assert.ok(!text.includes(SERVER_CODE), `the server's code is shown: ${text}`);
      assert.ok(!text.toLowerCase().includes('zebra'), `a piece of the server's words is shown: ${text}`);
    });
  }
});

describe('the send-code way', () => {
  it('unreachable: the server could not be reached', async () => {
    const { readRefusal, sendCodeRefusalText } = await load();
    assert.equal(sendCodeRefusalText(readRefusal(noAnswerError())), UNREACHABLE);
  });

  it('400: that phone number does not look right', async () => {
    const { readRefusal, sendCodeRefusalText } = await load();
    assert.equal(sendCodeRefusalText(readRefusal(httpError(400))), BAD_PHONE);
    assert.equal(sendCodeRefusalText(readRefusal(httpError(400, SERVER_BODY))), BAD_PHONE);
  });

  for (const code of ['msg91.send_failed', 'msg91.timeout', 'msg91.']) {
    it(`400 with a code starting msg91. (${code}): the code could not be sent just now`, async () => {
      const { readRefusal, sendCodeRefusalText } = await load();
      assert.equal(
        sendCodeRefusalText(readRefusal(httpError(400, { error: code, message: SERVER_SENTENCE }))),
        'The code could not be sent just now. Please try again in a little while.',
      );
    });
  }

  it('400 with a code that only mentions msg91 further on: still the phone sentence', async () => {
    const { readRefusal, sendCodeRefusalText } = await load();
    assert.equal(
      sendCodeRefusalText(readRefusal(httpError(400, { error: 'sms.msg91.failed' }))),
      BAD_PHONE,
    );
  });

  it("429: the server's own sentence when it sent one", async () => {
    const { readRefusal, sendCodeRefusalText } = await load();
    assert.equal(
      sendCodeRefusalText(readRefusal(httpError(429, { message: '  Wait 2 minutes, then send a new code. ' }))),
      'Wait 2 minutes, then send a new code.',
    );
  });

  it('429: the too-many sentence when the server sent none', async () => {
    const { readRefusal, sendCodeRefusalText } = await load();
    assert.equal(sendCodeRefusalText(readRefusal(httpError(429))), TOO_MANY);
    assert.equal(sendCodeRefusalText(readRefusal(httpError(429, { message: '  ' }))), TOO_MANY);
  });

  for (const code of [401, ...OTHER_STATUSES]) {
    it(`anything else (${code}): something went wrong`, async () => {
      const { readRefusal, sendCodeRefusalText } = await load();
      assert.equal(sendCodeRefusalText(readRefusal(httpError(code, SERVER_BODY))), WENT_WRONG);
    });
  }
});

describe('the check-code way', () => {
  it('401: that code is not right', async () => {
    const { readRefusal, checkCodeRefusalText } = await load();
    assert.equal(
      checkCodeRefusalText(readRefusal(httpError(401, SERVER_BODY))),
      'That code is not right. Check the SMS and try again.',
    );
  });

  it('410: that code has expired', async () => {
    const { readRefusal, checkCodeRefusalText } = await load();
    assert.equal(
      checkCodeRefusalText(readRefusal(httpError(410, SERVER_BODY))),
      'That code has expired. Send a new code.',
    );
  });

  it('404: there is no code waiting for this number', async () => {
    const { readRefusal, checkCodeRefusalText } = await load();
    assert.equal(
      checkCodeRefusalText(readRefusal(httpError(404, SERVER_BODY))),
      'There is no code waiting for this number. Send a new code.',
    );
  });

  it('400 with code otp.invalid_code: enter the code from the SMS', async () => {
    const { readRefusal, checkCodeRefusalText } = await load();
    assert.equal(
      checkCodeRefusalText(readRefusal(httpError(400, { error: 'otp.invalid_code' }))),
      'Enter the code from the SMS.',
    );
  });

  for (const body of [undefined, SERVER_BODY, { error: 'otp.invalid_phone' }, { error: 'msg91.send_failed' }]) {
    it(`any other 400 (${JSON.stringify(body?.error)}): that phone number does not look right`, async () => {
      const { readRefusal, checkCodeRefusalText } = await load();
      assert.equal(checkCodeRefusalText(readRefusal(httpError(400, body))), BAD_PHONE);
    });
  }

  it("429: the server's own sentence when it sent one, else the too-many sentence", async () => {
    const { readRefusal, checkCodeRefusalText } = await load();
    assert.equal(
      checkCodeRefusalText(readRefusal(httpError(429, { message: 'Wait 5 minutes before the next try.' }))),
      'Wait 5 minutes before the next try.',
    );
    assert.equal(checkCodeRefusalText(readRefusal(httpError(429))), TOO_MANY);
    assert.equal(checkCodeRefusalText(readRefusal(httpError(429, { message: ' ' }))), TOO_MANY);
  });

  it('unreachable: the server could not be reached', async () => {
    const { readRefusal, checkCodeRefusalText } = await load();
    assert.equal(checkCodeRefusalText(readRefusal(noAnswerError())), UNREACHABLE);
  });

  for (const code of [403, 409, 418, 422, 500, 502, 503]) {
    it(`anything else (${code}): something went wrong`, async () => {
      const { readRefusal, checkCodeRefusalText } = await load();
      assert.equal(checkCodeRefusalText(readRefusal(httpError(code, SERVER_BODY))), WENT_WRONG);
    });
  }
});

describe('the answer way', () => {
  it('unreachable: the server could not be reached', async () => {
    const { readRefusal, answerRefusalText } = await load();
    assert.equal(answerRefusalText(readRefusal(noAnswerError())), UNREACHABLE);
  });

  it("429: the server's own sentence when it sent one, else the too-many sentence", async () => {
    const { readRefusal, answerRefusalText } = await load();
    assert.equal(
      answerRefusalText(readRefusal(httpError(429, { message: 'Wait 1 minute, then answer again.' }))),
      'Wait 1 minute, then answer again.',
    );
    assert.equal(answerRefusalText(readRefusal(httpError(429))), TOO_MANY);
    assert.equal(answerRefusalText(readRefusal(httpError(429, { message: '' }))), TOO_MANY);
  });

  for (const code of [400, 401, ...OTHER_STATUSES]) {
    it(`anything else (${code}): your answer could not be saved`, async () => {
      const { readRefusal, answerRefusalText } = await load();
      assert.equal(
        answerRefusalText(readRefusal(httpError(code, SERVER_BODY))),
        'Your answer could not be saved. Please try again.',
      );
    });
  }
});

describe('building a session from a sign-in answer', () => {
  const answer = {
    userId: 'a3f1c2d4-0000-4000-8000-00000000abcd',
    accessToken: 'token-from-sign-in',
    expiresAtUtc: at(NOON + HOUR),
  };

  it('builds one from an answer that carries a user id, a token and an expiry', async () => {
    const { toSession } = await load();
    setClock(NOON);
    assert.deepEqual(toSession(answer), {
      accessToken: 'token-from-sign-in',
      refreshToken: null,
      userId: 'a3f1c2d4-0000-4000-8000-00000000abcd',
      expiresAtUtc: at(NOON + HOUR),
      signedInAtUtc: at(NOON),
    });
  });

  it('sets the sign-in time to now', async () => {
    const { toSession } = await load();
    setClock(NOON + 7 * HOUR);
    assert.equal(toSession(answer)?.signedInAtUtc, at(NOON + 7 * HOUR));
  });

  it('keeps no refresh token, even when the answer carries one', async () => {
    const { toSession } = await load();
    const withRefreshToken: Record<string, unknown> = {
      ...answer,
      refreshToken: 'refresh-token-from-the-body',
    };
    const session = toSession(withRefreshToken);
    assert.notEqual(session, null);
    assert.equal(session?.refreshToken, null);
    assert.ok(!JSON.stringify(session).includes('refresh-token-from-the-body'));
  });

  for (const field of ['userId', 'accessToken', 'expiresAtUtc'] as const) {
    it(`builds none when the answer has no ${field}`, async () => {
      const { toSession } = await load();
      const without: Record<string, unknown> = { ...answer };
      delete without[field];
      assert.equal(toSession(without), null);
      assert.equal(toSession({ ...answer, [field]: null }), null);
      assert.equal(toSession({ ...answer, [field]: '' }), null);
    });
  }

  it('builds none when there is no answer', async () => {
    const { toSession } = await load();
    assert.equal(toSession(null), null);
    assert.equal(toSession(undefined), null);
    assert.equal(toSession({}), null);
  });
});

describe('writing a wait', () => {
  it('45 seconds: "45 sec"', async () => {
    const { formatWait } = await load();
    assert.equal(formatWait(45), '45 sec');
  });

  it('120 seconds: "2 min"', async () => {
    const { formatWait } = await load();
    assert.equal(formatWait(120), '2 min');
  });

  it('125 seconds: "2 min 5 sec"', async () => {
    const { formatWait } = await load();
    assert.equal(formatWait(125), '2 min 5 sec');
  });
});
