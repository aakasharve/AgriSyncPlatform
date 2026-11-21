import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import AppVersionsPage from '../AppVersionsPage';

/**
 * spec: company-mis-real-numbers-2026-11-15 (plan CR-2d, Review Focus 3, Task 3 Step 1).
 * Written by the test-writer from the plan and the joined server's answer.
 *
 * The page was written for the older console shell and the recording lane's answer. Review
 * Focus 3: its fetch and types must match the JOINED server's answer, and a field that answer
 * does not carry reads "not measured", never 0. D-141's default: web sign-ins are counted apart
 * from phones.
 *
 * The answer below is the joined server's `AdminResponseDto<AppVersionsDto>`
 * (`ShramSafal.Application/Contracts/Dtos/AppVersionsDto.cs`, camelCase as the API writes it).
 * Every value is made up.
 */

const WAIT = 15_000;

function joinedAnswer() {
  return {
    days: 7,
    measuredSinceUtc: '2026-11-12T00:00:00Z',
    people: 41,
    phones: 37,
    otherDevices: 5,
    peopleWithUnknownDevice: 3,
    newestVersion: '1.0.19',
    legacyVersionNumber: '0.9.0',
    versions: [
      { appVersion: '1.0.19', people: 29, isNewest: true },
      { appVersion: '1.0.18', people: 8, isNewest: false },
      { appVersion: '0.9.0', people: 4, isNewest: false },
    ],
    onOlderVersions: [
      { name: 'Fake Person Alpha', farmNames: ['Fake Farm Alpha'], appVersion: '1.0.18', lastSeenUtc: '2026-11-18T06:00:00Z' },
      { name: null, farmNames: [], appVersion: '0.9.0', lastSeenUtc: '2026-11-17T06:00:00Z' },
    ],
  } as Record<string, unknown>;
}

function envelope(data: unknown) {
  return {
    data,
    meta: { source: 'live', window: 'last 7 days', lastRefreshedUtc: '2026-11-19T06:00:00Z', ttlSeconds: 0 },
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

function serve(data: Record<string, unknown>) {
  stub = installAdapter(async () => ({ status: 200, data: envelope(data) }));
  return stub;
}

/** The figure tile a label belongs to (KpiCard writes its honesty state on the tile). */
function tile(label: string): HTMLElement {
  const tileElement = screen.getByText(label).closest<HTMLElement>('[data-state]');
  if (!tileElement) throw new Error(`no figure tile for "${label}"`);
  return tileElement;
}

/** The tile's figure: its first child (KpiCard puts the value first, on purpose). */
function figure(label: string): string {
  return tile(label).firstElementChild?.textContent ?? '';
}

describe('the app-versions page reads the joined server answer (Review Focus 3)', () => {
  it('App_versions_page_renders_the_joined_answer', async () => {
    serve(joinedAnswer());
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });

    expect(await screen.findByRole('table', { name: 'App versions in use' }, { timeout: WAIT })).toBeInTheDocument();

    // The fetch: the joined server's route, the period in the query, one request.
    expect(stub!.requests.map((r) => r.url)).toEqual(['/shramsafal/admin/ops/app-versions?days=7']);

    // The figures, as the server counted them.
    expect(tile('People who used the app')).toHaveAttribute('data-state', 'ok');
    expect(figure('People who used the app')).toBe('41');
    expect(figure('Phones signed in')).toBe('37');
    // Everyone not on the newest version: 8 + 4.
    expect(figure('People on an older version')).toBe('12');

    // D-141: web sign-ins apart from phones, never added into the phone figure.
    const phones = tile('Phones signed in');
    expect(within(phones).getByText(/5 browser sign-ins/)).toBeInTheDocument();
    expect(within(phones).getByText(/3 people whose sign-in did not say which device/)).toBeInTheDocument();

    // The versions, newest first; the number every release up to 1.0.17 reports is never shown as a release.
    const versions = within(screen.getByRole('table', { name: 'App versions in use' }));
    expect(versions.getByText('1.0.19')).toBeInTheDocument();
    expect(versions.getByText('newest seen in use')).toBeInTheDocument();
    expect(versions.getByText('1.0.18')).toBeInTheDocument();
    expect(versions.getByText('1.0.17 or earlier')).toBeInTheDocument();
    expect(versions.getByText('reports as 0.9.0')).toBeInTheDocument();

    // The people still on an older version: a name, or the plain words when there is none.
    const people = within(screen.getByRole('table', { name: 'People still on an older version' }));
    expect(people.getByText('Fake Person Alpha')).toBeInTheDocument();
    expect(people.getByText('Fake Farm Alpha')).toBeInTheDocument();
    expect(people.getByText('No name on record')).toBeInTheDocument();
  });

  it('reads a figure the answer does not carry as "not measured", never 0', async () => {
    const answer = joinedAnswer();
    // An answer without these fields (absent, or null) is still an answer; each one is unknown.
    delete answer.people;
    delete answer.phones;
    delete answer.otherDevices;
    answer.peopleWithUnknownDevice = null;
    answer.versions = [
      { appVersion: '1.0.19', people: 29, isNewest: true },
      { appVersion: '1.0.18', isNewest: false },
    ];
    serve(answer);
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });

    expect(await screen.findByRole('table', { name: 'App versions in use' }, { timeout: WAIT })).toBeInTheDocument();

    for (const label of ['People who used the app', 'Phones signed in', 'People on an older version']) {
      expect(tile(label), label).toHaveAttribute('data-state', 'unmeasured');
      expect(figure(label), label).toContain('not measured');
      expect(figure(label), label).not.toMatch(/\d/);
    }
    // The browser and unknown-device counts under the phone figure say the same, in words.
    const phones = tile('Phones signed in');
    expect(within(phones).getByText(/browser sign-ins: not measured/)).toBeInTheDocument();
    expect(within(phones).getByText(/people: not measured/)).toBeInTheDocument();

    // The version row without its count: "not measured" in the cell, not a 0.
    const row = within(screen.getByRole('table', { name: 'App versions in use' }))
      .getByText('1.0.18')
      .closest('tr') as HTMLElement;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('not measured');
    expect(cells[1].textContent).not.toMatch(/\d/);

    // Nowhere on the page does a missing figure turn into a zero.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 /)).not.toBeInTheDocument();
  });

  it('says counting has not started, never zero, before the first row is recorded', async () => {
    const answer = joinedAnswer();
    answer.measuredSinceUtc = null;
    answer.people = 0;
    answer.versions = [];
    answer.onOlderVersions = [];
    serve(answer);
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });

    expect(await screen.findByText('Counting has not started', undefined, { timeout: WAIT })).toBeInTheDocument();
    await waitFor(() => expect(tile('People who used the app')).toHaveAttribute('data-state', 'unmeasured'));
    expect(figure('People who used the app')).not.toMatch(/\d/);
    expect(figure('People on an older version')).not.toMatch(/\d/);
    expect(screen.queryByRole('table', { name: 'App versions in use' })).not.toBeInTheDocument();
  });
  // spec: trusted-control-room-2026-11-20 (CR-3 Task A7, AM7; server rule in Task A4).
  it('Hidden_names_say_why_and_counts_stay', async () => {
    const answer = joinedAnswer();
    // A Viewer seat holds Server health but not All farms: the server sends the counts, no names,
    // and says why.
    answer.onOlderVersions = [];
    answer.onOlderVersionsHiddenReason = 'needs_all_farms';
    serve(answer);
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });

    // The counts are as they are today ...
    expect(await screen.findByRole('table', { name: 'App versions in use' }, { timeout: WAIT })).toBeInTheDocument();
    expect(figure('People who used the app')).toBe('41');
    expect(figure('People on an older version')).toBe('12');
    // ... and the sentence stands in place of the list.
    expect(
      screen.getByText('Names are hidden: seeing who is on an older version needs the All farms tick.'),
    ).toBeInTheDocument();
    // Never a list that reads as "nobody is on an older version".
    expect(screen.queryByRole('table', { name: 'People still on an older version' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No one was seen on an older version/)).not.toBeInTheDocument();
  });

  it('An_unknown_hidden_reason_keeps_counts_and_says_names_are_hidden', async () => {
    const answer = joinedAnswer();
    answer.onOlderVersions = [];
    answer.onOlderVersionsHiddenReason = 'some_future_reason';
    serve(answer);
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });

    expect(await screen.findByRole('table', { name: 'App versions in use' }, { timeout: WAIT })).toBeInTheDocument();
    expect(figure('People who used the app')).toBe('41');
    expect(figure('People on an older version')).toBe('12');
    expect(screen.getByText('Names are hidden.')).toBeInTheDocument();
    // Not the needs-a-tick sentence, not a false zero, not an empty list.
    expect(screen.queryByText(/needs the All farms tick/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No one was seen on an older version/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'People still on an older version' })).not.toBeInTheDocument();
  });

  it('with no hidden reason, the names show as before', async () => {
    const answer = joinedAnswer();
    answer.onOlderVersionsHiddenReason = null;
    serve(answer);
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });

    expect(
      await screen.findByRole('table', { name: 'People still on an older version' }, { timeout: WAIT }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Names are hidden/)).not.toBeInTheDocument();
  });
});
