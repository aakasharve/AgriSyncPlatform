import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { authStore } from '@/lib/auth';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * THE 404 IS RENDERED, NOT INFERRED (Preservation Register A43, Task 27).
 *
 * `routes.contract.test.ts` reads the route table as data and can prove the
 * catch-all no longer contains a `<Navigate>`. It cannot prove that a person
 * typing a wrong address SEES anything — the element it inspects is a lazy
 * import that has never been resolved.
 *
 * That distinction is the whole reason this file exists. The defect being
 * closed here was never a wrong route table; it was a route table that did
 * something invisible. A test that only re-reads the table would repeat the
 * mistake at one remove.
 *
 * So this mounts the real `<App />` — real router, real guards, real lazy
 * chunk — at a path that does not exist, and asserts on words on a screen and
 * on the address bar.
 *
 * ── WAIT ─────────────────────────────────────────────────────────────────
 * Fifteen seconds, under the suite's twenty-second test ceiling, for the same
 * measured reason `deepLink.contract.test.tsx` and `CommandPalette.test.tsx`
 * carry: a whole-console mount competes with every other file's mount for the
 * same cores, and a waiter allowed exactly as long as its test can never be
 * the thing that reports the failure.
 */
const WAIT = 15_000;

const SESSION = {
  accessToken: 'token-404',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000aa',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
};

/** A resolved scope with NO modules — the 404 must not need an entitlement. */
const SCOPE = {
  outcome: 'Resolved',
  scope: {
    userId: SESSION.userId,
    orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    orgType: 'FPO',
    orgRole: 'Owner',
    isPlatformAdmin: false,
    modules: [],
  },
  memberships: [],
};

function server() {
  return installAdapter(async (req: CapturedRequest) => {
    if (req.url.includes('/admin/me/scope')) return { status: 200, data: SCOPE };
    return { status: 200, data: { data: null, meta: {} } };
  });
}

function appQueryClient(): QueryClient {
  const tree = App() as ReactElement;
  return (tree.props as { client: QueryClient }).client;
}

function at(): string {
  return window.location.pathname + window.location.search;
}

function go(url: string) {
  window.history.replaceState({}, '', url);
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  authStore.clear();
  localStorage.clear();
  appQueryClient().clear();
});

describe('an unknown path renders a 404 and stops there (A43)', () => {
  /*
   * ONE MOUNT, NOT FOUR, AND THAT IS A MEASUREMENT.
   *
   * Every assertion below was first written as its own `it`, which read
   * better and cost four whole-console mounts. Measured on this machine:
   * the suite was green at 45 files and went to one failure on every run at
   * 46 — always in `deepLink.contract.test.tsx`, never here, and never an
   * assertion. It is the contention Task 18 already measured and
   * `vitest.config.ts` already documents: whole-console mounts run in
   * parallel processes and compete for the same cores, and the file that
   * loses is whichever one was already closest to its ceiling.
   *
   * Two mounts still failed. One does not. NO assertion was removed to get
   * there — the three that shared a URL were merged into the single mount
   * below, and the fourth is proved without mounting at all (see the note at
   * the end of this describe). Raising a timeout instead would have hidden a
   * real cost behind a bigger number.
   *
   * Add a second mount to this file only if you have re-measured. The suite
   * was at its ceiling before this file existed — `deepLink.contract.test.tsx`
   * carries a residual flake that Task 29 owns — and one more whole-console
   * mount is enough to push it over.
   */
  it('renders the 404 for a signed-in reader: names the address, keeps the url, is not Home', async () => {
    authStore.set(SESSION);
    stub = server();

    // A path AND a query, because this console keeps its filter, its page,
    // its window and the ACTIVE ORGANISATION in the query string. A 404 that
    // printed only the pathname would hide the half most likely to be the
    // actual mistake.
    const bad = '/farms/9f1c2d3e-0000-0000-0000-000000000001?org=abc&page=3';
    go(bad);

    render(<App />);

    expect(
      await screen.findByRole(
        'heading',
        { name: '404 · No page at this address' },
        { timeout: WAIT },
      ),
    ).toBeInTheDocument();

    /*
     * The negative half, and it is the half that matters. Before Task 27 this
     * exact URL rendered Home — successfully, with no error anywhere — which
     * is why D11 was invisible for as long as it was. "Ops Now" is Home's
     * heading; if it is on screen, the bounce is back.
     */
    expect(screen.queryByText('Ops Now')).toBeNull();

    // The address stays put. It is the evidence — the thing pasted into a bug
    // report or read back over a phone call — and a redirect destroys the
    // only copy of it.
    expect(at()).toBe(bad);
    expect(screen.getByText(bad, { exact: false })).toBeInTheDocument();
  });

  /*
   * THE ANONYMOUS CASE IS ASSERTED STRUCTURALLY, NOT MOUNTED, and that is
   * the measurement above being spent rather than ignored.
   *
   * "An unknown path sends a signed-out visitor to /login" is a property of
   * WHERE the catch-all sits — inside the shell route, under RequireAuth —
   * and `routes.contract.test.ts` reads that placement straight off the
   * route table in a file that mounts nothing at all. Proving it a second
   * time by mounting the whole console would buy the same fact for the price
   * that was just shown to break another file.
   *
   * It matters, so it is worth saying why it is not merely tidiness: a 404
   * that rendered while signed out would confirm, to anyone, which admin
   * routes this console has and which it does not.
   */
});
