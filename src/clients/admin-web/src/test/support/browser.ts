/**
 * Stand-ins for the parts of a browser the console's sign-in code touches: the store
 * (`localStorage`), the page's address (`window.location`), the `online` and `visibilitychange`
 * events, and the lock that lets one tab at a time do something (`navigator.locks`).
 *
 * There is no browser where the tests run. A test puts these on `globalThis` BEFORE it loads the
 * module it is testing. Nothing here knows how that module works.
 */

function putOnGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

/** The browser's store. It can be told to refuse, as a browser that blocks site data does. */
export class FakeStore {
  private readonly items = new Map<string, string>();

  /** While true, every read throws. */
  refuseReads = false;

  /** While true, every write and every removal throws. */
  refuseWrites = false;

  // What the page itself calls.

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    if (this.refuseReads) throw new Error('This browser does not let the page read its store.');
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.refuseWrites) throw new Error('This browser does not let the page write its store.');
    this.items.set(key, String(value));
  }

  removeItem(key: string): void {
    if (this.refuseWrites) throw new Error('This browser does not let the page write its store.');
    this.items.delete(key);
  }

  clear(): void {
    if (this.refuseWrites) throw new Error('This browser does not let the page write its store.');
    this.items.clear();
  }

  // What a test does from outside the page. Never refused.

  /** What is kept under the key, or null. */
  peek(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  put(key: string, value: string): void {
    this.items.set(key, value);
  }

  drop(key: string): void {
    this.items.delete(key);
  }

  /** Empties the store and makes it readable and writable again. */
  wipe(): void {
    this.items.clear();
    this.refuseReads = false;
    this.refuseWrites = false;
  }

  /** Everything the store holds, as one piece of text: to show that something is nowhere in it. */
  everything(): string {
    return JSON.stringify([...this.items.entries()]);
  }
}

/** Puts the store where the page looks for it, and hands it back. */
export function installStore(store: FakeStore = new FakeStore()): FakeStore {
  putOnGlobal('localStorage', store);
  return store;
}

type Listener = (event: { type: string }) => void;

/** The listening half of `window` and of `document`. */
class FakeEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener = (type: string, listener: Listener): void => {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  };

  removeEventListener = (type: string, listener: Listener): void => {
    this.listeners.get(type)?.delete(listener);
  };

  /** Tells every listener of the event, as the browser would. */
  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  /** How many listeners the event has now. */
  listening(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeWindow extends FakeEvents {
  /** Every address the page was sent to with `location.assign`, in order. */
  readonly opened: string[] = [];

  readonly location: {
    pathname: string;
    search: string;
    href: string;
    assign: (address: string) => void;
  };

  constructor(pathname: string) {
    super();
    this.location = {
      pathname,
      search: '',
      href: `https://console.invalid${pathname}`,
      assign: (address: string) => {
        this.opened.push(address);
      },
    };
  }
}

class FakeDocument extends FakeEvents {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

type LockCallback<T> = (lock: { name: string }) => T | Promise<T>;

/**
 * `navigator.locks`: one holder per name at a time. A test can make the next caller wait its
 * turn, as it does in a browser while another tab holds the lock.
 */
export class FakeLocks {
  /** The name of every lock asked for, in order. */
  readonly asked: string[] = [];

  private readonly lastHolder = new Map<string, Promise<unknown>>();
  private otherTab: Promise<void> | null = null;
  private otherTabDone: (() => void) | null = null;

  /** From now on a caller waits, as behind another tab, until `otherTabIsDone()`. */
  otherTabHoldsTheLock(): void {
    this.otherTab = new Promise<void>((resolve) => {
      this.otherTabDone = resolve;
    });
  }

  otherTabIsDone(): void {
    this.otherTabDone?.();
    this.otherTab = null;
    this.otherTabDone = null;
  }

  request = <T>(name: string, ...rest: unknown[]): Promise<T> => {
    const callback = rest[rest.length - 1] as LockCallback<T>;
    this.asked.push(name);
    const before = this.lastHolder.get(name) ?? Promise.resolve();
    const otherTab = this.otherTab;
    const turn = before
      .catch(() => {
        // The holder before failed; the lock is free all the same.
      })
      .then(() => otherTab ?? undefined)
      .then(() => callback({ name }));
    this.lastHolder.set(name, turn);
    return turn;
  };
}

export interface FakeBrowser {
  store: FakeStore;
  window: FakeWindow;
  document: FakeDocument;
  locks: FakeLocks;
  /** Every address the page was sent to (`window.location.assign`), in order. */
  opened: string[];
  /**
   * Whether this browser has `navigator.locks` at all. An old browser has none, and no browser
   * has them on a page served over plain http. They are there unless a test takes them away.
   */
  setLocksAvailable(available: boolean): void;
}

/**
 * Puts a whole pretend browser on `globalThis`: store, `window`, `document` and `navigator`.
 * `path` is the page the browser is on. `navigator` is always replaced, because newer Node has
 * one of its own (with real locks) and older Node has none: the tests must see the same thing on
 * both.
 */
export function openBrowser(options: { store?: FakeStore; path?: string } = {}): FakeBrowser {
  const store = installStore(options.store);
  const fakeWindow = new FakeWindow(options.path ?? '/');
  const fakeDocument = new FakeDocument();
  const locks = new FakeLocks();
  const setLocksAvailable = (available: boolean): void => {
    putOnGlobal('navigator', available ? { locks, onLine: true } : { onLine: true });
  };
  putOnGlobal('window', fakeWindow);
  putOnGlobal('document', fakeDocument);
  setLocksAvailable(true);
  return {
    store,
    window: fakeWindow,
    document: fakeDocument,
    locks,
    opened: fakeWindow.opened,
    setLocksAvailable,
  };
}
