import net from 'node:net';

/**
 * NO TEST REACHES A REAL HOST — plan CR-2d D14 (4).
 *
 * `setup.ts` already refuses every unstubbed request at the axios transport, for `adminApi` and
 * (since aa268066) for axios's default instance, which the session renewal uses. That is a block
 * on the two clients we know of. This is the wire under every client: every TCP or TLS
 * connection a test process opens (axios's XHR and http adapters, jsdom's XMLHttpRequest, Node's
 * fetch) goes through `net.Socket.prototype.connect`. While the suite runs, that method records
 * where it was asked to go and fails the socket with an error, WITHOUT dialling: no lookup, no
 * connection, nothing leaves this computer.
 *
 * `setup.ts` arms it before every test file and fails the test (and the file) during which an
 * attempt was recorded, naming the address. So the day a new client, a new adapter, or a removed
 * block lets a request through, the suite goes red instead of quietly calling the API on this
 * computer (`localhost:5048` is the PC test stack's API port, which tests must never touch).
 * `realHost.contract.test.ts` proves it is armed and that the leak D14 (4) found stays closed.
 */

const attempts: string[] = [];

interface ConnectTarget {
  host?: string;
  port?: number | string;
  path?: string;
}

/** Where a `connect(...)` call was asked to go, in words, from any of the forms Node accepts. */
function describeTarget(args: unknown[]): string {
  // `net.connect` hands the socket its already-normalised arguments as one array.
  const first: unknown = Array.isArray(args[0]) ? args[0][0] : args[0];
  const second: unknown = Array.isArray(args[0]) ? undefined : args[1];
  if (typeof first === 'object' && first !== null) {
    const target = first as ConnectTarget;
    if (target.path) return target.path;
    return `${target.host ?? 'localhost'}:${target.port ?? '(no port)'}`;
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return `${typeof second === 'string' ? second : 'localhost'}:${first}`;
  }
  return String(first);
}

/**
 * Stands in for `net.Socket.prototype.connect`. It never calls the real one. The socket fails
 * the way a refused connection fails (an 'error' event, then 'close'), on the next turn, so every
 * client takes its own "no answer" path and none is left waiting.
 */
export function tripwireConnect(this: net.Socket, ...args: unknown[]): net.Socket {
  const target = describeTarget(args);
  attempts.push(target);
  const refusal = new Error(
    `[admin-web tests] a test tried to open a network connection to ${target}. ` +
      'Tests never reach a real host; stub the call with installAdapter() (src/test/stubAdapter.ts).',
  );
  process.nextTick(() => this.destroy(refusal));
  return this;
}

/** Puts the tripwire on the wire. Called by `setup.ts` before every test file. */
export function armRealHostTripwire(): void {
  net.Socket.prototype.connect = tripwireConnect as unknown as typeof net.Socket.prototype.connect;
}

/** The addresses tests have tried to reach since the last call, oldest first; clears the record. */
export function takeRealHostAttempts(): string[] {
  return attempts.splice(0, attempts.length);
}
