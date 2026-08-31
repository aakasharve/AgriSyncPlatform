import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { ActiveOrgProvider, useActiveOrg } from '@/app/ActiveOrgProvider';
import { useListUrlState } from '@/lib/useListUrlState';

/**
 * WHY THIS FILE USES BrowserRouter AND THE REAL jsdom URL, NOT
 * `renderWithProviders`.
 *
 * `renderWithProviders` mounts a MemoryRouter, whose location lives in React
 * state and is invisible to `window.location`. A test that asserted on
 * MemoryRouter's params would be asserting that a copy of the query string
 * kept the org — which proves nothing about the address bar the founder
 * actually shares, bookmarks and reloads. That is the trap
 * `renderWithProviders.tsx` warns about wearing different clothes: a green
 * test that cannot fail is worse than no test, because it licenses the exact
 * bug it claims to prevent.
 *
 * So: the URL is set with `window.history.replaceState` before render, the
 * router is a real BrowserRouter reading it, and every assertion below reads
 * `window.location.search` back. `src/test/setup.ts` resets both the URL and
 * localStorage after each test.
 *
 * PROOF THESE TESTS HAVE TEETH (Task 7, run twice before committing):
 *
 *   A. `set()` rewritten to the object form — 8 of 21 red, including both
 *      org tests. "keeps ?org through a filter change" reported
 *      `expected null to be '3f2a9c11-…'`, and the reload test reported
 *      `expected 'none' to be '3f2a9c11-…'` — the dropped org, named.
 *   B. `write()` — the single functional-form choke point every writer goes
 *      through — rewritten to build a fresh URLSearchParams and hand it over
 *      as an object: 12 of 21 red. That is the blast radius, and it is the
 *      reason `write` is one function instead of five.
 *
 * Run A is also why the first assertion below clicks TWO buttons. The
 * original version only exercised `toggle()`, so sabotaging `set()` left it
 * green: a test that could not fail for the bug it was named after, which is
 * worse than no test because it licenses exactly that bug.
 */

/** A real UUID, because `ActiveOrgProvider` validates the shape (`isUuidLike`). */
const ORG = '3f2a9c11-4d7e-4b8a-9c31-0a1b2c3d4e5f';

function at(url: string): void {
  window.history.replaceState({}, '', url);
}

function qs(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function Harness({ draftKey }: { draftKey?: string }) {
  const q = useListUrlState(draftKey ? { draftKey } : {});
  return (
    <div>
      <button onClick={() => q.toggle('tier', 'B')}>tier B</button>
      <button onClick={() => q.set('tier', 'C')}>tier C</button>
      <button onClick={() => q.set('tier', null)}>tier none</button>
      <button onClick={() => q.setPage(4)}>page 4</button>
      <button onClick={() => q.setMany({ tier: 'D', endpoint: '/farms' })}>two at once</button>
      <button onClick={() => q.reset()}>reset</button>
      <button onClick={() => q.commitDraft()}>Search</button>
      <button onClick={() => q.toggleSort('score', 'desc')}>sort score</button>
      <button onClick={() => q.toggleSort('farmerName', 'asc')}>sort name</button>
      <button onClick={() => q.setOpen(!q.isOpen)}>toggle open</button>
      <input aria-label="draft" {...q.draftInputProps} />
      <input aria-label="endpoint" {...q.blurCommitInputProps('endpoint')} />
      <output data-testid="page">{q.page}</output>
      <output data-testid="sort">{`${q.sortKey ?? 'none'}/${q.sortDir}`}</output>
      <output data-testid="open">{q.isOpen ? 'open' : 'closed'}</output>
      <output data-testid="draft">{q.draft}</output>
    </div>
  );
}

/** Renders the hook's exported surface so the shape can be asserted from the DOM. */
function Probe() {
  const surface = Object.keys(useListUrlState()).sort().join(',');
  return <output data-testid="surface">{surface}</output>;
}

function ShowOrg() {
  const { activeOrgId } = useActiveOrg();
  return <output data-testid="active-org">{activeOrgId ?? 'none'}</output>;
}

function renderAt(url: string, ui = <Harness />) {
  at(url);
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

describe('the org param — the bug this hook exists to make unreachable', () => {
  it('keeps ?org through a filter change, whichever writer made it', async () => {
    // Deliberately exercises BOTH writers a filter chip can reach. An earlier
    // draft of this test only clicked the `toggle` button, so sabotaging
    // `set()` left it green — a test that could not fail for the bug it was
    // named after. Every write path gets asserted, or the proof is theatre.
    const user = userEvent.setup();
    renderAt(`/farms?org=${ORG}&page=3&search=arve`);

    await user.click(screen.getByRole('button', { name: 'tier C' })); // set()

    expect(qs().get('org')).toBe(ORG);
    expect(qs().get('search')).toBe('arve');
    expect(qs().get('tier')).toBe('C');
    // A20: every filter change resets the page.
    expect(qs().get('page')).toBe('1');

    await user.click(screen.getByRole('button', { name: 'tier B' })); // toggle()

    expect(qs().get('org')).toBe(ORG);
    expect(qs().get('search')).toBe('arve');
    expect(qs().get('tier')).toBe('B');
  });

  it('the active org survives a filter change across a reload', async () => {
    // The teeth are here. An org dropped from the URL still LOOKS fine inside
    // the session that dropped it. The damage lands on the next reload, or on
    // whoever the link was shared with. Unmounting and remounting the provider
    // over the same browser url is that reload.
    //
    // localStorage is cleared first ON PURPOSE: a stored org would rescue the
    // missing URL param and this test would pass while proving nothing.
    //
    // CHANGED IN TASK 12: the remount is now wrapped in a BrowserRouter.
    // `ActiveOrgProvider` reads the org through `useSearchParams` (Step 2),
    // so it requires a router — and a BrowserRouter reads the same jsdom url
    // this test has been asserting on all along, which is why the assertion
    // itself does not move.
    localStorage.clear();
    const user = userEvent.setup();

    const { unmount } = renderAt(`/farms?org=${ORG}&page=3`);
    await user.click(screen.getByRole('button', { name: 'tier C' }));
    unmount();

    render(
      <BrowserRouter>
        <ActiveOrgProvider>
          <ShowOrg />
        </ActiveOrgProvider>
      </BrowserRouter>,
    );

    expect(screen.getByTestId('active-org').textContent).toBe(ORG);
  });

  it('reset() clears every filter but never the org', async () => {
    const user = userEvent.setup();
    renderAt(`/farms?org=${ORG}&page=5&search=arve&tier=C&sort=score&dir=desc&open=1`);

    await user.click(screen.getByRole('button', { name: 'reset' }));

    expect(qs().get('org')).toBe(ORG);
    expect([...qs().keys()]).toEqual(['org']);
  });

  it('exposes no way to replace the whole query string', () => {
    // A hook that permits the dangerous call will eventually be called
    // dangerously. `setSearchParams` never leaves this module, and this test
    // is what stops a later task quietly re-exporting it "for convenience".
    renderAt('/farms', <Probe />);
    const surface = (screen.getByTestId('surface').textContent ?? '').split(',');

    expect(surface).not.toContain('setSearchParams');
    expect(surface).toEqual(
      [
        'blurCommitInputProps',
        'commitDraft',
        'draft',
        'draftInputProps',
        'get',
        'isOpen',
        'page',
        'params',
        'reset',
        'set',
        'setDraft',
        'setMany',
        'setOpen',
        'setPage',
        'setSort',
        'sortDir',
        'sortKey',
        'toggle',
        'toggleSort',
      ].sort(),
    );
  });
});

describe('page reset (A20)', () => {
  it('reads a missing or junk page as 1, never NaN and never 0', () => {
    renderAt('/farms?page=not-a-number');
    expect(screen.getByTestId('page')).toHaveTextContent('1');
  });

  it('paging does not reset the page it just set', async () => {
    const user = userEvent.setup();
    renderAt(`/farms?org=${ORG}&tier=B`);

    await user.click(screen.getByRole('button', { name: 'page 4' }));

    expect(qs().get('page')).toBe('4');
    expect(qs().get('tier')).toBe('B');
    expect(qs().get('org')).toBe(ORG);
  });

  it('setMany writes both keys in ONE navigation and still resets the page', async () => {
    // Two separate set() calls in one handler would not work: React Router's
    // setSearchParams closes over the current render's params, so the second
    // call builds from the pre-first-call snapshot and clobbers the first.
    const user = userEvent.setup();
    renderAt(`/ops/errors?org=${ORG}&page=7`);

    await user.click(screen.getByRole('button', { name: 'two at once' }));

    expect(qs().get('tier')).toBe('D');
    expect(qs().get('endpoint')).toBe('/farms');
    expect(qs().get('page')).toBe('1');
    expect(qs().get('org')).toBe(ORG);
  });

  it('an empty value deletes the key rather than writing an empty one', async () => {
    const user = userEvent.setup();
    renderAt(`/farms?org=${ORG}&tier=C`);

    await user.click(screen.getByRole('button', { name: 'tier none' }));

    expect(qs().has('tier')).toBe(false);
    expect(qs().get('org')).toBe(ORG);
  });

  it('toggle removes the chip that is already applied (the tier chips)', async () => {
    const user = userEvent.setup();
    renderAt(`/farms?org=${ORG}&tier=B`);

    await user.click(screen.getByRole('button', { name: 'tier B' }));

    expect(qs().has('tier')).toBe(false);
  });
});

describe('two commit contracts that look identical in a screenshot (A21)', () => {
  it('DRAFT: typing writes nothing to the URL until Search is pressed', async () => {
    const user = userEvent.setup();
    renderAt(`/users?org=${ORG}`);

    await user.type(screen.getByLabelText('draft'), 'purvesh');

    // Not one keystroke reached the URL — no history entry per character, no
    // refetch per character.
    expect(qs().get('search')).toBeNull();
    expect(window.location.search).toBe(`?org=${ORG}`);
    expect(screen.getByTestId('draft')).toHaveTextContent('purvesh');

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(qs().get('search')).toBe('purvesh');
  });

  it('DRAFT: Enter is the other explicit commit', async () => {
    const user = userEvent.setup();
    renderAt(`/users?org=${ORG}`);

    await user.type(screen.getByLabelText('draft'), 'arve{Enter}');

    expect(qs().get('search')).toBe('arve');
    expect(qs().get('org')).toBe(ORG);
  });

  it('DRAFT: leaving the box does NOT commit — the contracts do not collapse', async () => {
    const user = userEvent.setup();
    renderAt(`/users?org=${ORG}`);

    await user.click(screen.getByLabelText('draft'));
    await user.keyboard('purvesh');
    await user.tab();

    expect(qs().get('search')).toBeNull();
  });

  it('BLUR: the endpoint filter commits on blur, trimmed', async () => {
    const user = userEvent.setup();
    renderAt(`/ops/errors?org=${ORG}`);

    await user.click(screen.getByLabelText('endpoint'));
    await user.keyboard('  /shramsafal/admin/farms  ');

    // Still nothing: this contract commits when you LEAVE the box, not per key.
    expect(qs().get('endpoint')).toBeNull();

    await user.tab();

    expect(qs().get('endpoint')).toBe('/shramsafal/admin/farms');
    expect(qs().get('page')).toBe('1');
    expect(qs().get('org')).toBe(ORG);
  });

  it('BLUR: the endpoint filter also commits on Enter, trimmed', async () => {
    const user = userEvent.setup();
    renderAt(`/ops/errors?org=${ORG}`);

    await user.click(screen.getByLabelText('endpoint'));
    await user.keyboard('  /shramsafal/admin/users  {Enter}');

    expect(qs().get('endpoint')).toBe('/shramsafal/admin/users');
    expect(qs().get('org')).toBe(ORG);
  });

  it('BLUR: the input is uncontrolled, so it seeds from the URL and is not re-rendered by it', () => {
    renderAt('/ops/errors?endpoint=%2Fops%2Fhealth');
    const input = screen.getByLabelText('endpoint') as HTMLInputElement;

    expect(input.value).toBe('/ops/health');
    // `defaultValue`, not `value` — making this controlled would change WHEN
    // the filter applies (OpsErrorsPage.tsx:103-110).
    expect(input.getAttribute('value')).toBe('/ops/health');
  });
});

describe('sort and the summary-first flag — in the URL, which is new (Step 4)', () => {
  it('round-trips the sort key and direction through the URL', async () => {
    const user = userEvent.setup();
    renderAt(`/farmer-health?org=${ORG}`);

    await user.click(screen.getByRole('button', { name: 'sort score' }));
    expect(qs().get('sort')).toBe('score');
    expect(qs().get('dir')).toBe('desc');
    expect(screen.getByTestId('sort')).toHaveTextContent('score/desc');

    // Same column flips direction.
    await user.click(screen.getByRole('button', { name: 'sort score' }));
    expect(qs().get('dir')).toBe('asc');

    // A different column adopts ITS OWN default direction, which the call
    // site supplies (A30: farmerName opens ascending, score descending).
    await user.click(screen.getByRole('button', { name: 'sort name' }));
    expect(qs().get('sort')).toBe('farmerName');
    expect(qs().get('dir')).toBe('asc');

    expect(qs().get('org')).toBe(ORG);
  });

  it('a sorted URL survives a reload — sort dies on refresh today', () => {
    // InterventionQueueTable.tsx:44-45 keeps sort in component state, so a
    // reload throws it away. Reading it back out of the URL is the fix.
    renderAt('/farmer-health?sort=weeklyDelta&dir=desc');
    expect(screen.getByTestId('sort')).toHaveTextContent('weeklyDelta/desc');
  });

  it('an unrecognised direction reads as asc rather than as itself', () => {
    renderAt('/farmer-health?sort=score&dir=DESCENDING');
    expect(screen.getByTestId('sort')).toHaveTextContent('score/asc');
  });

  it('the open flag round-trips and does NOT throw the reader back to page 1', async () => {
    const user = userEvent.setup();
    renderAt(`/farms?org=${ORG}&page=3`);

    expect(screen.getByTestId('open')).toHaveTextContent('closed');

    await user.click(screen.getByRole('button', { name: 'toggle open' }));

    expect(qs().get('open')).toBe('1');
    expect(screen.getByTestId('open')).toHaveTextContent('open');
    // Expanding the list is not a filter — it changes no row's membership.
    expect(qs().get('page')).toBe('3');
    expect(qs().get('org')).toBe(ORG);

    await user.click(screen.getByRole('button', { name: 'toggle open' }));

    expect(qs().has('open')).toBe(false);
  });
});

describe('the draft key is configurable, because not every screen calls it search', () => {
  it('commits into the key it was given', async () => {
    const user = userEvent.setup();
    renderAt(`/ops/errors?org=${ORG}`, <Harness draftKey="endpoint" />);

    await user.type(screen.getByLabelText('draft'), '/ops{Enter}');

    expect(qs().get('endpoint')).toBe('/ops');
    expect(qs().get('search')).toBeNull();
  });

  it('seeds the draft from the URL on mount, so a shared link fills the box', () => {
    renderAt(`/users?org=${ORG}&search=purvesh`);
    expect(screen.getByTestId('draft')).toHaveTextContent('purvesh');
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('purvesh');
  });
});
