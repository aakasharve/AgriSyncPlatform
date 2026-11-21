import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { authStore } from '@/lib/auth';
import { ModuleKeys } from '@/lib/moduleKeys';
import { resetMisPeriod } from '@/features/mis/misPeriod';
import { GHOST } from '@/features/mis/misTheme';
import { COMPANY_MIS_PATH } from '@/hooks/useCompanyMis';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';
import { misEnvelope, misFixture } from '@/test/misFixture';
import { PAGE_NAMES, S_OPS_HEADLINE, S_SMS, S_SUPPORT } from '@/test/misPlan';
import {
  MIS_NOW, MIS_SECTIONS, countedShown, misCalls, pageTextWithoutRange, renderMis, serveMis,
} from '@/test/misPage';

/**
 * CR-2b Task 4 — the seven pages, the filter row and the states.
 * Expected behaviour from the plan (Task 4, Global Constraints, B2, B6).
 */

/** D-156b: the founder's own button label for this console page; the "no AI wording" rule is for the farmer app. */
const COPY_FOR_AI_LABEL = 'Copy for AI (text)';

let stub: StubbedAdapter | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIS_NOW);
  resetMisPeriod();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.useRealTimers();
});

const ghosts = (root: ParentNode) =>
  [...root.querySelectorAll('path')].filter((p) => (p.getAttribute('stroke') ?? '').toLowerCase() === GHOST.toLowerCase());

describe('the seven pages read one answer (CR-2b Task 4)', () => {
  it('Each_page_renders_from_one_answer', async () => {
    for (const s of MIS_SECTIONS) {
      stub = serveMis();
      const v = renderMis(s);
      await countedShown();
      expect(screen.getByRole('heading', { level: 1 }).textContent?.trim()).toBe(PAGE_NAMES[s]);
      expect(v.container.querySelectorAll('[data-mis-item]').length).toBeGreaterThan(3);
      expect(misCalls(stub)).toHaveLength(1);
      v.unmount();
      stub.restore();
      stub = null;
      resetMisPeriod();
    }
  });

  it('Switching_pages_does_not_recount', async () => {
    stub = serveMis();
    renderMis('overview');
    await countedShown();
    fireEvent.click(screen.getByRole('button', { name: 'open retention' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Retention' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open quality' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Quality' })).toBeInTheDocument();
    await countedShown();
    await new Promise((r) => setTimeout(r, 30));
    expect(misCalls(stub)).toHaveLength(1);
  });

  it('Compare_adds_and_removes_the_previous_line_without_recounting', async () => {
    stub = serveMis();
    const { container } = renderMis('overview');
    await countedShown();
    const hero = () => container.querySelector('section[data-mis-item="overview.activeFarms"]') as HTMLElement;
    const dau = () => screen.getByTestId('kpi-overview.dau');

    // Compare is on by default: the period before is drawn from served values and the tiles say "from".
    expect(ghosts(hero()).length).toBeGreaterThan(0);
    expect(within(dau()).getByText('from 129')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));
    expect(ghosts(container)).toHaveLength(0);
    expect(within(dau()).queryByText('from 129')).toBeNull();
    expect(container.textContent).not.toContain('Previous period');
    // The current line and the numbers stay.
    expect(screen.getByTestId('kpi-overview.dau-value').textContent).toBe('143');

    fireEvent.click(screen.getByRole('switch'));
    expect(ghosts(hero()).length).toBeGreaterThan(0);
    expect(within(dau()).getByText('from 129')).toBeInTheDocument();

    await new Promise((r) => setTimeout(r, 30));
    expect(misCalls(stub)).toHaveLength(1);
  });

  it('A_new_range_recounts_once', async () => {
    stub = serveMis();
    renderMis('engagement');
    await countedShown();
    expect(misCalls(stub)[0].url).toBe(`${COMPANY_MIS_PATH}?from=2026-10-16&to=2026-11-14`);

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(misCalls(stub!)).toHaveLength(2));
    expect(misCalls(stub)[1].url).toBe(`${COMPANY_MIS_PATH}?from=2026-11-08&to=2026-11-14`);
    fireEvent.click(screen.getByRole('button', { name: 'open farms' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(misCalls(stub)).toHaveLength(2);
  });

  it('Test_accounts_left_out_agree_with_their_number', async () => {
    // B18 V5: "1 test account left out" / "2 test accounts left out".
    for (const [n, words] of [[1, '1 test account left out'], [2, '2 test accounts left out'], [0, 'No test accounts are set up to be left out, so test phones are counted']] as const) {
      stub = serveMis(async () => ({ status: 200, data: misEnvelope(misFixture({ excludedTestAccounts: n })) }));
      const v = renderMis('overview');
      await countedShown();
      expect([n, screen.getByTestId('mis-test-accounts').textContent]).toEqual([n, words]);
      v.unmount();
      stub.restore();
      stub = null;
      resetMisPeriod();
    }
  });

  it('Every_page_says_when_it_was_counted', async () => {
    stub = serveMis();
    renderMis('overview');
    for (const s of MIS_SECTIONS) {
      fireEvent.click(screen.getByRole('button', { name: `open ${s}` }));
      const at = await countedShown();
      expect([s, at.textContent]).toEqual([s, 'Counted at 15 Nov 2026, 2:32 pm India time']);
    }
  });
});

describe('states that show no number (CR-2b Task 4)', () => {
  it('Loading_shows_no_numbers', async () => {
    stub = serveMis(neverSettles);
    const { container } = renderMis('overview');
    expect(await screen.findByText('Counting the company numbers')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-mis-item]')).toHaveLength(0);
    expect(pageTextWithoutRange()).not.toMatch(/\d/);
  });

  it('Platform_only_shows_the_plain_refusal_and_no_numbers', async () => {
    stub = serveMis(async () => ({ status: 403, data: { code: 'admin_platform_only' } }));
    const { container } = renderMis('farms');
    expect(await screen.findByText('Not shown to this account')).toBeInTheDocument();
    expect(screen.getByTestId('mis-dashboard').textContent).toContain('This screen is for Platform owners only.');
    expect(container.querySelectorAll('[data-mis-item]')).toHaveLength(0);
    expect(pageTextWithoutRange()).not.toMatch(/\d/);
  });

  it('A_failed_count_shows_no_numbers', async () => {
    stub = serveMis(async () => ({ status: 500, data: { message: 'read failed' } }));
    const { container } = renderMis('retention');
    await waitFor(() => expect(screen.getByTestId('mis-dashboard').textContent).toMatch(/could not be counted/));
    expect(container.querySelectorAll('[data-mis-item]')).toHaveLength(0);
    expect(pageTextWithoutRange()).not.toMatch(/\d/);
    expect(misCalls(stub)).toHaveLength(1);
  });

  it('A_bad_range_offers_the_30_day_reset', async () => {
    stub = serveMis(async (req) =>
      req.url.includes('from=2026-11-08')
        ? { status: 400, data: { code: 'mis_range_invalid', message: 'bad' } }
        : { status: 200, data: misEnvelope() });
    const { container } = renderMis('overview');
    await countedShown();

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() =>
      expect(screen.getByTestId('mis-dashboard').textContent).toContain(
        'That date range cannot be counted. Pick an end date no later than today and at most 180 days.',
      ));
    expect(container.querySelectorAll('[data-mis-item]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Retry|Try again/i }));
    await countedShown();
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('[data-mis-item]').length).toBeGreaterThan(3);
  });

  /* No_session_leaves_no_numbers MOVED, IN THE CR-2d JOIN (plan D14 (3)), to
     MisPages.noSession.test.tsx: under the SMS sign-in (PR 95) a 401 ends the session only when the
     server also refuses the renewal, and an ended session ends the page (no data request leaves
     after it), so that test needs a page, a file, of its own. */
});

describe('words on the pages (CR-2b Task 4)', () => {
  it('Operations_says_nothing_is_measured_yet', async () => {
    stub = serveMis();
    const { container } = renderMis('operations');
    await countedShown();
    expect(screen.getByTestId('mis-headline').textContent).toBe(S_OPS_HEADLINE);
    const items = [...container.querySelectorAll('[data-mis-item]')];
    expect(items.length).toBe(11);
    for (const el of items) {
      expect(el.textContent).not.toMatch(/\d/);
      // The headline (item 73) is checked whole above; every other item names one of the two reasons.
      if (el.getAttribute('data-testid') === 'mis-headline') continue;
      expect([el.getAttribute('data-mis-item'), el.textContent?.includes(S_SMS) || el.textContent?.includes(S_SUPPORT)])
        .toEqual([el.getAttribute('data-mis-item'), true]);
    }
  });

  it('The_honest_notes_are_visible', async () => {
    stub = serveMis();
    renderMis('overview');
    await countedShown();
    const has = (text: string) => (screen.getByTestId('mis-dashboard').textContent ?? '').includes(text);
    const notes: [string, string][] = [
      ['overview', 'Only entries that came from a voice recording the app understood and checked.'],
      ['engagement', 'Times are when an entry reached the server; an entry saved without signal counts when the phone next connected.'],
      ['retention', 'by sign-up week (phone verified), not install'],
      ['quality', 'Counted only from the day the app version that records corrections went live.'],
      ['quality', "The speech service's own time, not the whole wait the farmer sees."],
    ];
    for (const [s, note] of notes) {
      fireEvent.click(screen.getByRole('button', { name: `open ${s}` }));
      await countedShown();
      expect([s, note, has(note)]).toEqual([s, note, true]);
    }
    // B24 (founder, 2026-11-17): the tile's `what` line takes the place of the static hint, so DAU, WAU and
    // MAU each say it through that line ("People who saved at least one entry ...").
    fireEvent.click(screen.getByRole('button', { name: 'open overview' }));
    for (const k of ['dau', 'wau', 'mau']) {
      /* W-14 and m6: DAU, WAU and MAU say the entry reached the server. */
      const words = 'at least one entry that reached the server'; // m6: DAU, WAU and MAU all say it
      expect([k, screen.getByTestId(`kpi-overview.${k}`).textContent?.includes(words)]).toEqual([k, true]);
    }
    // Retention: both the cohort grid and the curve carry the sign-up-week note.
    fireEvent.click(screen.getByRole('button', { name: 'open retention' }));
    const dash = screen.getByTestId('mis-dashboard');
    for (const item of ['retention.cohorts', 'retention.curve']) {
      const el = dash.querySelector(`section[data-mis-item="${item}"]`);
      expect([item, el?.textContent?.includes('by sign-up week (phone verified), not install')]).toEqual([item, true]);
    }
  });

  it('No_internal_or_ai_words_and_no_emoji_on_any_page', async () => {
    stub = serveMis();
    renderMis('overview');
    for (const s of MIS_SECTIONS) {
      fireEvent.click(screen.getByRole('button', { name: `open ${s}` }));
      await countedShown();
      // D-156b: the console's one "Copy for AI (text)" button is the founder's own wording; nothing else may say AI.
      const text = (screen.getByTestId('mis-dashboard').textContent ?? '').replace(COPY_FOR_AI_LABEL, '');
      const titles = [...screen.getByTestId('mis-dashboard').querySelectorAll('[title],[aria-label]')]
        .map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`).join(' ');
      for (const t of [text, titles]) {
        expect([s, /\bAI\b/.test(t)]).toEqual([s, false]);
        expect([s, /matview/i.test(t)]).toEqual([s, false]);
        expect([s, /\bRLS\b/.test(t)]).toEqual([s, false]);
        expect([s, /\bDTO\b/.test(t)]).toEqual([s, false]);
        expect([s, /\p{Extended_Pictographic}/u.test(t)]).toEqual([s, false]);
        expect([s, /sample data/i.test(t)]).toEqual([s, false]);
        expect([s, /data up to/i.test(t)]).toEqual([s, false]);
        expect([s, /Comparison changes the numbers only/.test(t)]).toEqual([s, false]);
      }
    }
  });
});

describe('the console frame on a Company MIS page (CR-2b Task 4)', () => {
  const SESSION = {
    accessToken: 'token-mis-shell',
    refreshToken: null,
    userId: '00000000-0000-0000-0000-0000000000cc',
    expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
    signedInAtUtc: new Date(Date.now()).toISOString(),
  };

  function appQueryClient(): QueryClient {
    const tree = App() as ReactElement;
    return (tree.props as { client: QueryClient }).client;
  }

  function shellServer() {
    return installAdapter(async (req) => {
      if (req.url.includes('/admin/me/scope')) {
        return {
          status: 200,
          data: {
            outcome: 'Resolved',
            scope: {
              userId: SESSION.userId,
              orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              orgType: 'Platform',
              orgRole: 'Owner',
              isPlatformAdmin: true,
              modules: [{ key: ModuleKeys.MetricsNsm, canRead: true, canWrite: false, canExport: false }],
            },
            memberships: [],
          },
        };
      }
      if (req.url.includes(COMPANY_MIS_PATH)) return { status: 200, data: misEnvelope() };
      return { status: 200, data: { data: { items: [], totalCount: 0, page: 1, pageSize: 40 }, meta: { source: 'live', window: '24h', lastRefreshedUtc: new Date().toISOString(), ttlSeconds: 60 } } };
    });
  }

  afterEach(() => {
    appQueryClient().clear();
  });

  it('Refresh_is_hidden_on_MIS_pages', async () => {
    vi.useRealTimers();
    resetMisPeriod();
    authStore.set(SESSION);
    stub = shellServer();

    // Control: the shell's Refresh exists on an ordinary screen.
    window.history.replaceState({}, '', '/');
    const home = render(<App />);
    expect(await screen.findByRole('button', { name: /Refresh/ }, { timeout: 15_000 })).toBeInTheDocument();
    home.unmount();

    window.history.replaceState({}, '', '/MIS/overview');
    render(<App />);
    expect(await screen.findByTestId('mis-counted-at', undefined, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
  });
});
