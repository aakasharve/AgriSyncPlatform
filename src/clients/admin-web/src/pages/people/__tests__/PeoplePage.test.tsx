import { Route, Routes, useLocation } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';
import type { PeopleAnswer, TrustReport as TrustReportData } from '@/hooks/useControlRoomPeople';
import HistoryPage from '../HistoryPage';
import PeoplePage from '../PeoplePage';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7; D-155, H13, K20, K15).
 *
 * People and access, built against the shapes Task A5 pins and proved with mocked answers: the
 * ticks, which of them are personal data and each role's pre-fill all come from the server's
 * answer. Test numbers are 9000000xxx and names "Example: ...".
 */

const WAIT = { timeout: 15_000 };
const F1 = 'f1111111-0000-0000-0000-000000000001';

const TICKS = [
  ['company_numbers', false],
  ['server_health', false],
  ['api_errors', false],
  ['all_farms', false],
  ['farms_to_call', false],
  ['farmer_health', false],
  ['schedules', false],
  ['users', false],
  ['farmer_phones', true],
  ['downloads', true],
  ['give_visits', false],
  ['my_visits', false],
] as const;

const ADMIN_PRESET = [...TICKS.slice(0, 8).map((t) => t[0]), 'farmer_phones', 'downloads', 'give_visits'];

function peopleAnswer(over: Partial<PeopleAnswer> = {}): PeopleAnswer {
  return {
    people: [
      {
        personId: null,
        isFounder: true,
        displayName: 'Example: Founder',
        phone: '9000000001',
        startingRole: 'founder',
        ticks: TICKS.map((t) => t[0]),
        boundAccountName: 'Example: Founder account',
        lastSignedInUtc: '2026-11-19T04:00:00Z',
        keptAtUtc: null,
      },
      {
        personId: F1,
        isFounder: false,
        displayName: 'Example: Field Person',
        phone: '9000000012',
        startingRole: 'field_operator',
        ticks: ['my_visits', 'farmer_phones', 'downloads'],
        boundAccountName: null,
        lastSignedInUtc: null,
        keptAtUtc: null,
      },
    ],
    ticks: TICKS.map(([key, isPersonalData]) => ({ key, isPersonalData })),
    presets: {
      admin: ADMIN_PRESET,
      field_operator: ['my_visits', 'farmer_phones', 'downloads'],
      viewer: ['company_numbers', 'server_health'],
    },
    ...over,
  };
}

const measured = (value: number) => ({ value, notMeasuredReason: null });
const notMeasured = (reason: string) => ({ value: null, notMeasuredReason: reason });

function report(over: Partial<TrustReportData> = {}): TrustReportData {
  return {
    countedAtUtc: '2026-11-20T10:00:00Z',
    peopleWithAccess: 2,
    peopleByRole: { admin: 0, field_operator: 1, viewer: 0 },
    phoneLooks: measured(12),
    phoneFarms: measured(7),
    phoneLookers: measured(2),
    downloads: notMeasured('downloads_start_with_field_visits'),
    downloadFarmRows: notMeasured('downloads_start_with_field_visits'),
    downloaders: notMeasured('downloads_start_with_field_visits'),
    notSignedIn30Days: [],
    notSignedInNotMeasuredReason: null,
    refusedAtDoor: measured(3),
    ...over,
  };
}

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

interface Served {
  people?: PeopleAnswer;
  trust?: TrustReportData;
  history?: unknown;
  onWrite?: (req: CapturedRequest) => { status: number; data: unknown } | undefined;
}

function serve({ people = peopleAnswer(), trust = report(), history = { lines: [], hitLimit: false, limit: 500 }, onWrite }: Served = {}) {
  stub = installAdapter(async (req) => {
    const url = req.url;
    if (req.method !== 'get') {
      const custom = onWrite?.(req);
      if (custom) return custom;
      return { status: req.method === 'post' && url.endsWith('/people') ? 201 : 200, data: {} };
    }
    if (url.includes('/people/trust-report')) return { status: 200, data: trust };
    if (url.includes('/people/history')) return { status: 200, data: history };
    if (url.includes('/people')) return { status: 200, data: people };
    return { status: 404, data: {} };
  });
  return stub;
}

const writes = (s: StubbedAdapter) => s.requests.filter((r) => r.method !== 'get');

function renderPeople() {
  return renderWithProviders(<PeoplePage />, { route: '/people' });
}

async function openAddPanel() {
  renderPeople();
  await userEvent.click(await screen.findByRole('button', { name: 'Add a person' }, WAIT));
  return screen.getByRole('form', { name: 'Add a person' });
}

const tick = (panel: HTMLElement, key: string) =>
  panel.querySelector<HTMLInputElement>(`[data-tick="${key}"] input[type="checkbox"]`)!;
const tickRow = (panel: HTMLElement, key: string) => panel.querySelector<HTMLElement>(`[data-tick="${key}"]`)!;

describe('People and access: the add panel', () => {
  it('Picking_a_role_prefills_its_ticks_and_leaves_them_editable', async () => {
    serve();
    const panel = await openAddPanel();

    // Nothing is ticked before a role is picked.
    for (const [key] of TICKS) expect(tick(panel, key).checked).toBe(false);

    await userEvent.click(within(panel).getByRole('button', { name: /^Viewer/ }));
    expect(tick(panel, 'company_numbers').checked).toBe(true);
    expect(tick(panel, 'server_health').checked).toBe(true);
    expect(tick(panel, 'users').checked).toBe(false);

    // Editable: add one, take one away.
    await userEvent.click(tick(panel, 'users'));
    await userEvent.click(tick(panel, 'company_numbers'));
    expect(tick(panel, 'users').checked).toBe(true);
    expect(tick(panel, 'company_numbers').checked).toBe(false);

    // Picking another role replaces the pre-fill with that role's own ticks.
    await userEvent.click(within(panel).getByRole('button', { name: /^Admin/ }));
    for (const key of ADMIN_PRESET) expect(tick(panel, key).checked, key).toBe(true);
    expect(tick(panel, 'my_visits').checked).toBe(false);
  });

  it('the founder is never a choice', async () => {
    serve();
    const panel = await openAddPanel();
    expect(within(panel).queryByRole('button', { name: /^Founder/ })).not.toBeInTheDocument();
    expect(within(panel).getAllByRole('button', { pressed: false }).map((b) => b.getAttribute('data-role'))).toEqual([
      'admin',
      'field_operator',
      'viewer',
    ]);
  });

  it('Field_operator_prefill_shows_the_phone_tick_ticked_and_orange_before_give_access', async () => {
    const s = serve();
    const panel = await openAddPanel();

    await userEvent.click(within(panel).getByRole('button', { name: /^Field operator/ }));

    for (const key of ['farmer_phones', 'downloads']) {
      expect(tick(panel, key).checked, `${key} is ticked`).toBe(true);
      expect(tickRow(panel, key).getAttribute('data-personal-data'), `${key} is marked`).toBe('true');
      expect(tickRow(panel, key).className, `${key} is orange`).toMatch(/border-amber/);
    }
    expect(tick(panel, 'my_visits').checked).toBe(true);
    expect(tick(panel, 'company_numbers').checked).toBe(false);

    // Nothing has been posted: the founder ticked it knowingly, before "Give access".
    expect(writes(s)).toHaveLength(0);

    await userEvent.type(within(panel).getByLabelText('Name'), 'Example: New Operator');
    await userEvent.type(within(panel).getByLabelText('Phone number'), '9000000012');
    expect(writes(s)).toHaveLength(0);
    await userEvent.click(within(panel).getByRole('button', { name: 'Give access' }));

    await waitFor(() => expect(writes(s)).toHaveLength(1), WAIT);
    const post = writes(s)[0];
    expect(post.method).toBe('post');
    expect(post.url).toContain('/shramsafal/admin/people');
    expect(post.body).toEqual({
      displayName: 'Example: New Operator',
      phone: '9000000012',
      startingRole: 'field_operator',
      ticks: ['farmer_phones', 'downloads', 'my_visits'],
    });
  });

  it('Phone_and_download_ticks_are_marked_as_personal_data', async () => {
    serve();
    const panel = await openAddPanel();

    for (const key of ['farmer_phones', 'downloads']) {
      expect(tickRow(panel, key).getAttribute('data-personal-data')).toBe('true');
      expect(tickRow(panel, key).className).toMatch(/bg-tint-amber/);
    }
    for (const key of ['company_numbers', 'give_visits', 'users']) {
      expect(tickRow(panel, key).getAttribute('data-personal-data')).toBeNull();
      expect(tickRow(panel, key).className).not.toMatch(/amber/);
    }
    expect(
      within(panel).getByText(
        "Orange ticks are actions with farmers' personal data. Each use of them is written in History with the person's name and the time.",
      ),
    ).toBeInTheDocument();
  });

  it('Visit_and_download_ticks_say_they_work_when_field_visits_arrive', async () => {
    serve();
    const panel = await openAddPanel();
    const NOTE = 'Works when field visits arrive (about 5-8 Dec)';

    for (const key of ['give_visits', 'my_visits', 'downloads']) {
      expect(within(tickRow(panel, key)).getByText(NOTE), key).toBeInTheDocument();
    }
    for (const key of ['company_numbers', 'farmer_phones', 'users']) {
      expect(within(tickRow(panel, key)).queryByText(NOTE), key).not.toBeInTheDocument();
    }
    // The role card of a role that pre-fills them says so too; the Viewer card does not.
    const card = (name: RegExp) => within(panel).getByRole('button', { name });
    expect(within(card(/^Field operator/)).getByText(NOTE)).toBeInTheDocument();
    expect(within(card(/^Admin/)).getByText(NOTE)).toBeInTheDocument();
    expect(within(card(/^Viewer/)).queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('shows a refusal as one plain sentence and keeps the panel open', async () => {
    serve({
      onWrite: () => ({ status: 409, data: { code: 'control_room.already_listed' } }),
    });
    const panel = await openAddPanel();
    await userEvent.click(within(panel).getByRole('button', { name: /^Viewer/ }));
    await userEvent.type(within(panel).getByLabelText('Name'), 'Example: Twice');
    await userEvent.type(within(panel).getByLabelText('Phone number'), '9000000012');
    await userEvent.click(within(panel).getByRole('button', { name: 'Give access' }));

    expect(await within(panel).findByRole('alert', undefined, WAIT)).toHaveTextContent(
      'This number is already on the list.',
    );
    expect(screen.getByRole('form', { name: 'Add a person' })).toBeInTheDocument();
  });
});

describe('People and access: the list', () => {
  it('The_founder_row_has_no_change_or_remove', async () => {
    serve();
    renderPeople();
    const row = (await screen.findByText('Example: Founder', undefined, WAIT)).closest('tr')!;

    expect(within(row).getByText('Founder: everything')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    // The person next to him does have both.
    const other = screen.getByText('Example: Field Person').closest('tr')!;
    expect(within(other).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(within(other).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('says the three pinned notes', async () => {
    serve();
    renderPeople();
    await screen.findByText('Example: Founder', undefined, WAIT);
    expect(
      screen.getByText('Home is open to everyone you approve. People and access is yours only and has no tick.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Orange ticks are actions with farmers' personal data\. Each use of them is written in History/),
    ).toBeInTheDocument();
    expect(screen.getByText('History cannot be edited or deleted, by anyone.')).toBeInTheDocument();
  });

  it('Remove_asks_once_then_posts_remove', async () => {
    const s = serve();
    renderPeople();
    const row = (await screen.findByText('Example: Field Person', undefined, WAIT)).closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    // Asked once; nothing sent yet.
    expect(within(row).getByText(/Remove Example: Field Person\?/)).toBeInTheDocument();
    expect(writes(s)).toHaveLength(0);

    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(writes(s)).toHaveLength(1), WAIT);
    expect(writes(s)[0].method).toBe('post');
    expect(writes(s)[0].url).toContain(`/shramsafal/admin/people/${F1}/remove`);
  });

  it('Cancel on the question posts nothing', async () => {
    const s = serve();
    renderPeople();
    const row = (await screen.findByText('Example: Field Person', undefined, WAIT)).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(writes(s)).toHaveLength(0);
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('Change opens the panel with the person as they are and saves with a PUT', async () => {
    const s = serve();
    renderPeople();
    const row = (await screen.findByText('Example: Field Person', undefined, WAIT)).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Change' }));

    const panel = await screen.findByRole('form', { name: 'Change Example: Field Person' });
    expect(tick(panel, 'my_visits').checked).toBe(true);
    expect(tick(panel, 'company_numbers').checked).toBe(false);
    await userEvent.click(tick(panel, 'company_numbers'));
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(writes(s)).toHaveLength(1), WAIT);
    expect(writes(s)[0].method).toBe('put');
    expect(writes(s)[0].url).toContain(`/shramsafal/admin/people/${F1}`);
    expect(writes(s)[0].body).toEqual({
      displayName: 'Example: Field Person',
      startingRole: 'field_operator',
      ticks: ['company_numbers', 'farmer_phones', 'downloads', 'my_visits'],
    });
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

describe('People and access: the weekly trust report', () => {
  it('The_trust_report_numbers_open_their_history_lines', async () => {
    const s = serve({
      history: {
        lines: [
          {
            atUtc: '2026-11-19T05:00:00Z',
            action: 'phones_shown',
            actorName: 'Example: Field Person',
            subjectName: null,
            details: { farmCount: '2', farms: 'Example Farm A, Example Farm B' },
          },
        ],
        hitLimit: false,
        limit: 500,
      },
    });
    renderWithProviders(
      <>
        <Where />
        <Routes>
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/history" element={<HistoryPage />} />
        </Routes>
      </>,
      { route: '/people' },
    );

    const looks = await screen.findByRole('link', { name: '12' }, WAIT);
    await userEvent.click(looks);

    await screen.findByRole('heading', { name: 'History' }, WAIT);
    expect(screen.getByTestId('where').textContent).toBe('/people/history?action=phones_shown&days=7');
    await waitFor(
      () => expect(s.requests.some((r) => r.url.includes('/people/history?days=7&action=phones_shown'))).toBe(true),
      WAIT,
    );
    expect(await screen.findByText("Example: Field Person looked at farmers' phone numbers for: Example Farm A, Example Farm B", undefined, WAIT)).toBeInTheDocument();
  });

  it('says "Showing the newest {limit}" only when the read hit its limit', async () => {
    serve({ history: { lines: [], hitLimit: true, limit: 500 } });
    renderWithProviders(<HistoryPage />, { route: '/people/history' });
    expect(await screen.findByText(/Showing the newest 500\./, undefined, WAIT)).toBeInTheDocument();
  });

  it('turned-away tries open the door_refused lines', async () => {
    serve();
    renderWithProviders(
      <>
        <Where />
        <Routes>
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/history" element={<HistoryPage />} />
        </Routes>
      </>,
      { route: '/people' },
    );
    await userEvent.click(await screen.findByRole('link', { name: '3' }, WAIT));
    await screen.findByRole('heading', { name: 'History' }, WAIT);
    expect(screen.getByTestId('where').textContent).toBe('/people/history?action=door_refused&days=7');
  });

  it('The_trust_report_says_downloads_start_with_field_visits_never_zero', async () => {
    serve();
    renderPeople();
    const block = (await screen.findByRole('heading', { name: 'Downloads' }, WAIT)).closest('section')!;

    expect(within(block).getAllByText('Downloads start with field visits')).toHaveLength(3);
    expect(block.textContent).not.toMatch(/\b0\b/);
    expect(within(block).queryByRole('link')).not.toBeInTheDocument();
  });

  it('a count that hit its read limit says it is not counted, never a cut number', async () => {
    serve({
      trust: report({
        phoneLooks: notMeasured('history_read_limit'),
        phoneFarms: notMeasured('history_read_limit'),
        phoneLookers: notMeasured('history_read_limit'),
      }),
    });
    renderPeople();
    const block = (await screen.findByRole('heading', { name: "Farmers' phone numbers looked at" }, WAIT)).closest('section')!;
    expect(within(block).getAllByText('Not counted: there were too many lines to count exactly.')).toHaveLength(3);
    expect(within(block).queryByRole('link')).not.toBeInTheDocument();
  });

  it('lists who has not signed in for 30 days, and Keep posts keep', async () => {
    const s = serve({
      trust: report({
        notSignedIn30Days: [peopleAnswer().people[1]],
      }),
    });
    renderPeople();
    const block = (
      await screen.findByRole('heading', { name: 'Added 30 or more days ago, no sign-in in the last 30 days' }, WAIT)
    ).closest('section')!;
    await userEvent.click(within(block).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(writes(s)).toHaveLength(1), WAIT);
    expect(writes(s)[0].url).toContain(`/shramsafal/admin/people/${F1}/keep`);
  });

  it('No_sign_in_here_yet_reads_the_same_for_every_row_the_founders_included', async () => {
    const answer = peopleAnswer();
    answer.people[0] = { ...answer.people[0], lastSignedInUtc: null };
    serve({ people: answer });
    renderPeople();
    await screen.findByText('Example: Field Person', undefined, WAIT);
    expect(screen.getAllByText('No sign-in here yet')).toHaveLength(2);
    expect(screen.queryByText('Not signed in yet')).not.toBeInTheDocument();
  });

  it('The_trust_report_says_test_accounts_are_left_out_of_the_phone_looks', async () => {
    serve();
    renderPeople();
    const block = (await screen.findByRole('heading', { name: "Farmers' phone numbers looked at" }, WAIT)).closest('section')!;
    const note = 'Looks by anyone are counted, staff included. Only looks at test farms are left out.';
    expect(within(block).getByText(note)).toBeInTheDocument();
    const other = screen.getByRole('heading', { name: 'Downloads' }).closest('section')!;
    expect(within(other).queryByText(note)).not.toBeInTheDocument();
  });

  it('W-3: the phone-look number is labelled as times shown and opens exactly the counted lines', async () => {
    const s = serve({
      trust: report({
        phoneLooksFromUtc: '2026-11-15T10:00:00Z',
        phoneLooksToUtc: '2026-11-22T10:01:00Z',
        phoneLooksLeftOutTestFarmsOnly: measured(4),
      }),
      history: {
        lines: [
          {
            atUtc: '2026-11-19T05:00:00Z',
            action: 'phones_shown',
            actorName: 'Example: Field Person',
            subjectName: null,
            details: { page: 'farms', farms: 'Example Farm A' },
          },
        ],
        hitLimit: false,
        limit: 500,
      },
    });
    renderWithProviders(
      <>
        <Where />
        <Routes>
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/history" element={<HistoryPage />} />
        </Routes>
      </>,
      { route: '/people' },
    );
    const block = (await screen.findByRole('heading', { name: "Farmers' phone numbers looked at" }, WAIT)).closest('section')!;
    expect(within(block).getByText('Times phone numbers were shown')).toBeInTheDocument();
    expect(within(block).queryByText('Times looked at')).not.toBeInTheDocument();
    expect(within(block).getByTestId('phone-looks-test-only').textContent).toBe(
      '4 more were on test farms only and are not counted.',
    );

    await userEvent.click(within(block).getByRole('link', { name: '12' }));
    await screen.findByRole('heading', { name: 'History' }, WAIT);
    const where = screen.getByTestId('where').textContent!;
    expect(where).toContain('fromUtc=2026-11-15T10%3A00%3A00Z');
    expect(where).toContain('toUtc=2026-11-22T10%3A01%3A00Z');
    expect(where).toContain('countedLooksOnly=true');
    await waitFor(
      () =>
        expect(
          s.requests.some(
            (r) =>
              r.url.includes('/people/history?')
              && r.url.includes('fromUtc=2026-11-15T10%3A00%3A00Z')
              && r.url.includes('toUtc=2026-11-22T10%3A01%3A00Z')
              && r.url.includes('countedLooksOnly=true')
              && r.url.includes('action=phones_shown')
              && !r.url.includes('days='),
          ),
        ).toBe(true),
      WAIT,
    );
  });

  it('W-3: History sends days when no exact window is in the address, and ignores a lone end', async () => {
    const s = serve();
    renderWithProviders(<HistoryPage />, { route: '/people/history?fromUtc=2026-11-15T10:00:00Z' });
    await waitFor(() => expect(s.requests.some((r) => r.url.includes('/people/history?days=7'))).toBe(true), WAIT);
    expect(s.requests.every((r) => !r.url.includes('fromUtc'))).toBe(true);
  });

  it('W-3: no test-farms line when none were left out, and no such line when it is not measured', async () => {
    serve({ trust: report({ phoneLooksLeftOutTestFarmsOnly: measured(0) }) });
    const first = renderPeople();
    await screen.findByText('Times phone numbers were shown', undefined, WAIT);
    expect(screen.queryByTestId('phone-looks-test-only')).not.toBeInTheDocument();
    first.unmount();
    stub?.restore();
    serve({ trust: report({ phoneLooksLeftOutTestFarmsOnly: notMeasured('history_read_limit') }) });
    renderPeople();
    await screen.findByText('Times phone numbers were shown', undefined, WAIT);
    expect(screen.queryByTestId('phone-looks-test-only')).not.toBeInTheDocument();
  });

  it('W-4: the report says when History began, and says "since" while it is under 7 days old', async () => {
    serve({ trust: report({ historyStartedAtUtc: '2026-11-18T10:00:00Z' }) });
    renderPeople();
    expect((await screen.findByTestId('history-began', undefined, WAIT)).textContent).toBe('History began on 18 Nov 2026.');
    expect(screen.getByText(/Phone and door numbers are since 18 Nov 2026\./)).toBeInTheDocument();
    expect(screen.queryByText(/for the last 7 days/)).not.toBeInTheDocument();
  });

  it('W-4: History older than 7 days keeps "the last 7 days"; History with no line says so', async () => {
    serve({ trust: report({ historyStartedAtUtc: '2026-10-01T10:00:00Z' }) });
    const first = renderPeople();
    expect((await screen.findByTestId('history-began', undefined, WAIT)).textContent).toBe('History began on 1 Oct 2026.');
    expect(screen.getByText(/Phone and door numbers are for the last 7 days\./)).toBeInTheDocument();
    first.unmount();
    stub?.restore();
    serve({ trust: report({ historyStartedAtUtc: null }) });
    renderPeople();
    expect((await screen.findByTestId('history-began', undefined, WAIT)).textContent).toBe('History has no line yet.');
  });

  it('W-4: not signed in is two true groups, each with Keep, and the reason shows when not measured', async () => {
    const everyone = peopleAnswer().people;
    const s = serve({
      trust: report({
        notSignedIn30Days: [everyone[1]],
        neverSignedIn: [{ ...everyone[1], personId: 'f2222222-0000-0000-0000-000000000002', displayName: 'Example: New Person', addedAtUtc: '2026-11-21T05:00:00Z' }],
      }),
    });
    const first = renderPeople();
    const older = (
      await screen.findByRole('heading', { name: 'Added 30 or more days ago, no sign-in in the last 30 days' }, WAIT)
    ).closest('div')!;
    const never = screen.getByRole('heading', { name: 'Added, never signed in' }).closest('div')!;
    expect(within(older).getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    expect(within(never).getByText('Example: New Person')).toBeInTheDocument();
    expect(within(never).getByText(/added 21 Nov 2026/)).toBeInTheDocument();
    expect(screen.queryByText('Not signed in for 30 days')).not.toBeInTheDocument();
    await userEvent.click(within(never).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(writes(s)).toHaveLength(1), WAIT);
    expect(writes(s)[0].url).toContain('/people/f2222222-0000-0000-0000-000000000002/keep');
    first.unmount();
    stub?.restore();

    serve({ trust: report({ notSignedInNotMeasuredReason: 'history_read_limit' }) });
    renderPeople();
    const block = (await screen.findByTestId('not-signed-in', undefined, WAIT));
    expect(within(block).getByText('Not counted: there were too many lines to count exactly.')).toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument();
    expect(within(block).queryByText(/no one is in this group/i)).not.toBeInTheDocument();
  });

  it('says the people-with-access number is the current list', async () => {
    serve();
    renderPeople();
    expect(
      await screen.findByText('The list as it is now. Every other number here is counted from History.', undefined, WAIT),
    ).toBeInTheDocument();
  });
});
