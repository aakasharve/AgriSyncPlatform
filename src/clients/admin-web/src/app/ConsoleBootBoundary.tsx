import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * THE ONE STATE A READER CANNOT DIAGNOSE — a blank screen.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 * Every screen in this console is a `lazy()` import behind one `<Suspense>`
 * (`App.tsx:15-32`). Suspense handles a chunk that is STILL LOADING. It does
 * nothing at all for a chunk that FAILS to load — a rejected dynamic import
 * throws, and until this file there was no error boundary anywhere in the
 * application, so the throw reached the root and React unmounted the tree.
 *
 * That is not a hypothetical. A deploy replaces the hashed chunk files while a
 * console is open; the next navigation asks for a filename that no longer
 * exists, gets a 404 or an HTML error page, and the operator sees white. White
 * is indistinguishable from "the platform is fine and there is nothing to
 * show", which is the same collapse as a 500 rendered as "No errors found. The
 * system is healthy."
 *
 * ── Why it is written like this, and not with the console's own components ─
 * The v3 prototype's Home inlines its own SVG and its own markup for exactly
 * this state, and its comment says why: *"The icon is written out here rather
 * than fetched from AS.icon, because AS is exactly what may be missing."* The
 * React equivalent of that rule is:
 *
 *   1. STATICALLY IMPORTED. `App.tsx` imports this file directly, never through
 *      `lazy()`, so it is in the entry chunk and is present before anything can
 *      fail. A boundary that has to be fetched cannot report a failed fetch.
 *   2. NO COMPONENT DEPENDENCIES. No lucide icon, no `LoadFailed`, no
 *      `Button` — the SVG is inline and the markup is plain. Those live in
 *      chunks, and this component exists for the case where a chunk is the
 *      thing that broke.
 *   3. NO HOOKS AND NO DATA. It cannot ask for anything, because the reason it
 *      is on screen may be that asking is what failed.
 *
 * ── What it says ──────────────────────────────────────────────────────────
 * The copy is the prototype's, carried deliberately, because it is the honest
 * version of a crash: *"Nothing here is a zero and nothing here is healthy —
 * there is simply no reading."* A reload is offered because a stale chunk is
 * fixed by one, and it is the only action available to someone whose console
 * has no working code.
 *
 * React error boundaries must be class components. There is no hook form of
 * `componentDidCatch`, and that is the only reason this is a class.
 */

interface Props {
  children: ReactNode;
  /** Test seam — a boundary you cannot observe is a boundary nobody tests.
   *  Production passes nothing. */
  onError?: (error: unknown) => void;
}

interface State {
  failed: boolean;
  message: string | null;
}

export class ConsoleBootBoundary extends Component<Props, State> {
  state: State = { failed: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error && error.message ? error.message : null;
    return { failed: true, message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    /* The console's ONLY record of a crash. There is no error-reporting sink in
       this application — `/telemetry/client-error` is the FARMER app's, and it
       reads a farm claim no admin token carries — so this line and the reader's
       own eyes are the whole of the signal. Do not quietly swallow it. */
    console.error('[admin-console] a screen failed to render', error, info?.componentStack);
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        role="alert"
        data-boot-failure="console"
        className="grid min-h-screen place-items-center bg-page px-6 py-12"
      >
        <div className="flex max-w-[520px] flex-col items-center gap-3 text-center">
          <span className="text-red">
            {/* Inline, and not lucide's AlertTriangle — see property (2). */}
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4.5" />
              <path d="M12 17.2h.01" />
            </svg>
          </span>

          <p className="text-[17px] font-semibold text-text-1">
            This screen could not load its code
          </p>

          <p className="text-[15px] text-text-2">
            Part of the console failed to load, so nothing below can be shown. Nothing here is a
            zero and nothing here is healthy &mdash; there is simply no reading. If the console was
            open across a deployment, reloading fetches the current version.
          </p>

          {this.state.message && (
            <p className="text-[13px] text-text-3">
              The browser reported: {this.state.message}
            </p>
          )}

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-1 rounded-chip border border-line px-4 py-2 text-[15px] font-medium text-text-1 hover:bg-wash"
          >
            Reload the console
          </button>
        </div>
      </div>
    );
  }
}
