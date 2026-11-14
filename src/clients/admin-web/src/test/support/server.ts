/**
 * A pretend server. It takes the place of the network under every HTTP client in the test (it is
 * axios's "adapter"), so no request ever leaves the process. It writes down each request that
 * reaches it and answers with what the test prepared.
 */

import axios, {
  AxiosError,
  AxiosHeaders,
  CanceledError,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

/** One request that reached the pretend server. */
export interface Call {
  /** In capitals: GET, POST. */
  method: string;
  /** Where it was sent, without the server's own address: `/user/auth/refresh`. */
  path: string;
  /** The `Authorization` header, or null when the request had none. */
  authorization: string | null;
  /** True when the browser was told to send its cookies along. */
  withCredentials: boolean;
  /** The body, read back from what was sent. Undefined when there was none. */
  body: unknown;
}

/** What the server says: a status with a body, or nothing at all (offline, timed out). */
export type Answer = { status: number; body?: unknown } | 'no answer';

type Respond = (call: Call) => Answer | Promise<Answer>;

/** A 200 with this body. */
export function ok(body: unknown = {}): Answer {
  return { status: 200, body };
}

/** A refusal or a failure: any status that is not a 2xx. */
export function status(code: number, body?: unknown): Answer {
  return { status: code, body };
}

/** The request gets no answer at all. */
export const NO_ANSWER: Answer = 'no answer';

/** An answer the test gives later, while the request waits "in the air". */
export function heldAnswer(): { answer: Promise<Answer>; give: (answer: Answer) => void } {
  let give: (answer: Answer) => void = () => undefined;
  const answer = new Promise<Answer>((resolve) => {
    give = resolve;
  });
  return { answer, give };
}

function describeCall(config: InternalAxiosRequestConfig): Call {
  const address = new URL(axios.getUri(config), 'https://server.invalid');
  const header = AxiosHeaders.from(config.headers).get('Authorization');
  let body: unknown = config.data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // Not JSON: kept as the text it is.
    }
  }
  return {
    method: (config.method ?? 'get').toUpperCase(),
    path: address.pathname,
    authorization: typeof header === 'string' ? header : null,
    withCredentials: config.withCredentials === true,
    body,
  };
}

/** Rejects, the way a real network layer does, when the caller cuts the request off. */
function cutOff(config: InternalAxiosRequestConfig): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const signal = config.signal;
    if (!signal) return;
    const stop = () => {
      const stopped = new CanceledError<unknown>('canceled');
      stopped.config = config;
      reject(stopped);
    };
    if (signal.aborted) stop();
    else signal.addEventListener?.('abort', stop);
  });
}

export class FakeServer {
  /** Every request that reached the server, in the order it arrived. */
  readonly calls: Call[] = [];

  private readonly routes = new Map<string, Respond>();

  /** Prepares the answer for one route. Preparing it again replaces the earlier answer. */
  when(method: string, path: string, respond: Answer | Respond): this {
    this.routes.set(`${method} ${path}`, typeof respond === 'function' ? respond : () => respond);
    return this;
  }

  /** The requests that reached this path. */
  callsTo(path: string): Call[] {
    return this.calls.filter((call) => call.path === path);
  }

  /** Every request so far, as `METHOD path`, in order. */
  log(): string[] {
    return this.calls.map((call) => `${call.method} ${call.path}`);
  }

  /** Forgets every request and every prepared answer. */
  reset(): void {
    this.calls.length = 0;
    this.routes.clear();
  }

  readonly adapter: AxiosAdapter = async (config) => {
    const call = describeCall(config);
    this.calls.push(call);
    const respond = this.routes.get(`${call.method} ${call.path}`);
    if (!respond) {
      throw new Error(`No test prepared an answer for ${call.method} ${call.path}.`);
    }

    const answer = await Promise.race([Promise.resolve().then(() => respond(call)), cutOff(config)]);
    if (answer === 'no answer') {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
    }

    const response: AxiosResponse = {
      data: answer.body === undefined ? undefined : structuredClone(answer.body),
      status: answer.status,
      statusText: '',
      headers: new AxiosHeaders(),
      config,
      request: {},
    };
    if (answer.status >= 200 && answer.status < 300) return response;
    throw new AxiosError(
      `Request failed with status code ${answer.status}`,
      answer.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    );
  };

  /**
   * Puts this server under every HTTP client that is made from now on, and under axios's own
   * shared client. Call it before the module under test is loaded.
   */
  install(): this {
    axios.defaults.adapter = this.adapter;
    return this;
  }

  /** Puts this server under a client that already exists. */
  attach(client: AxiosInstance): this {
    client.defaults.adapter = this.adapter;
    return this;
  }
}

/** An error as axios gives it for a request the server answered with this status and body. */
export function httpError(code: number, body?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  const response: AxiosResponse = {
    data: body,
    status: code,
    statusText: '',
    headers: new AxiosHeaders(),
    config,
  };
  return new AxiosError(
    `Request failed with status code ${code}`,
    code >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    response,
  );
}

/** An error as axios gives it for a request that got no answer at all. */
export function noAnswerError(): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
}

/** An error as axios gives it for a request the caller itself cut off. */
export function stoppedError(): AxiosError {
  return new CanceledError<unknown>('canceled');
}
