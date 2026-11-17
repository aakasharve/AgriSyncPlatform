import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';
import FarmerHealthDrilldown from '../FarmerHealthDrilldown';

/**
 * B25 (2026-11-17), one-farm page: the real behaviours B24 retired without cover are asserted again
 * on the timeline rows. After CR-2e Task 3 all six rows are real (Started, Submitted, Proof, Summary,
 * Checked, Errors), so the one "Not built yet" cell the B25 tests pinned on the last two is retired.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = '22222222-2222-2222-2222-222222222222';
const WAIT = { timeout: 15_000 };

const days = Array.from({ length: 14 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 18 + i)).toISOString().slice(0, 10),
  closuresStarted: 0, closuresSubmitted: 0, proofAttached: 0, summariesViewed: 0, verifications: 0, errors: 0,
}));
days[12] = { ...days[12], closuresStarted: 4, closuresSubmitted: 3 };
days[13] = { ...days[13], closuresStarted: 1, proofAttached: 1, summariesViewed: 2, verifications: 83, errors: 97 };

const ANSWER = {
  farmId: FARM, farmerName: 'Zzfarmer Unique', farmName: 'Zzfarm Name', phone: '9000000033',
  score: null, timeline: days,
  syncState: { lastSyncAt: '2026-08-30T09:05:00.0000000Z' },
  aiHealth: null, verifications: null, workerSummary: [],
};

const scope = {
  outcome: 'Resolved',
  scope: {
    userId: 'u1', orgId: ORG, orgType: 'FPO', orgRole: 'Owner', isPlatformAdmin: false,
    modules: ['farmer.health', 'ops.errors', 'ops.voice'].map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
  },
  memberships: [{ orgId: ORG, orgName: 'Nashik Grape FPO', orgType: 'FPO', orgRole: 'Owner' }],
};

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function mount() {
  renderWithProviders(
    <Routes><Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} /></Routes>,
    { route: `/farmer-health/${FARM}?org=${ORG}` },
  );
}

async function shown() {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) return { status: 200, data: scope };
    if (req.url.includes('/admin/farmer-health/')) return { status: 200, data: ANSWER };
    return { status: 404, data: {} };
  });
  mount();
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /^Loading/ })).toHaveLength(0), WAIT);
  await waitFor(() => expect(document.querySelector('[data-band="timeline"] table')).not.toBeNull(), WAIT);
  return document.querySelector<HTMLElement>('[data-band="timeline"]')!;
}

function rowOf(timeline: HTMLElement, label: string): HTMLTableRowElement {
  const th = [...timeline.querySelectorAll('tbody th[scope="row"]')].find((h) => (h.textContent ?? '').trim().startsWith(label));
  expect(th, `row ${label}`).toBeTruthy();
  return th!.closest('tr') as HTMLTableRowElement;
}

describe('the one-farm timeline, real rows (B25)', () => {
  it('B25_each_real_row_is_shaded_against_its_own_busiest_day_and_says_so', async () => {
    const tl = await shown();
    expect(tl.querySelector('[data-scale-note]')!.textContent).toContain('against its own busiest day');
    // Four started on one day and a single proof on another: per-row scaling puts BOTH at the top of their ramp.
    const started = tl.querySelector<HTMLElement>('[data-cell="closuresStarted:2026-08-30"]')!;
    const proof = tl.querySelector<HTMLElement>('[data-cell="proofAttached:2026-08-31"]')!;
    const submitted = tl.querySelector<HTMLElement>('[data-cell="closuresSubmitted:2026-08-30"]')!;
    expect(started.title).toMatch(/: 4$/);
    expect(proof.title).toMatch(/: 1$/);
    expect(submitted.title).toMatch(/: 3$/);
    for (const c of [started, proof, submitted]) expect(c.style.backgroundColor).toContain('95%');
    // and a smaller day in the same row sits lower than that row's top
    const startedOne = tl.querySelector<HTMLElement>('[data-cell="closuresStarted:2026-08-31"]')!;
    expect(startedOne.title).toMatch(/: 1$/);
    expect(startedOne.style.backgroundColor).not.toContain('95%');
    expect(startedOne.style.backgroundColor).not.toBe('');
  });

  it('B25_the_six_real_rows_use_tokens_and_no_hex_colour', async () => {
    const tl = await shown();
    const cells = [...tl.querySelectorAll<HTMLElement>('[data-cell]')];
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): P4 and P5 became real
    expect(cells.length).toBe(6 * 14);
    for (const c of cells) expect(c.getAttribute('style') ?? '', c.getAttribute('data-cell') ?? '').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const lit = cells.filter((c) => (c.getAttribute('style') ?? '').includes('background-color'));
    expect(lit.length).toBeGreaterThan(0);
    for (const c of lit) expect(c.style.backgroundColor).toContain('var(--color-');
  });

  it('B25_the_accessible_table_names_all_six_event_types', async () => {
    const tl = await shown();
    const cap = (tl.querySelector('table caption')!.textContent ?? '').toLowerCase();
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): P4 and P5 became real
    for (const w of ['started', 'submitted', 'proof', 'summary', 'checked', 'errors']) expect(cap, w).toContain(w);
    expect(cap).not.toMatch(/not built yet/);
    expect(tl.querySelectorAll('table[aria-label="Activity by event type and day"] tbody tr')).toHaveLength(6);
  });
});

describe('the Checked and Errors rows are real rows (B25, CR-2e Task 3)', () => {
  it('B25_Checked_and_Errors_are_each_14_day_cells_with_the_served_values', async () => {
    const tl = await shown();
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): P4 and P5 became real
    for (const [label, key, value] of [['Checked', 'verifications', '83'], ['Errors', 'errors', '97']] as const) {
      const tr = rowOf(tl, label);
      expect([label, tr.querySelectorAll('td').length]).toEqual([label, 14]);
      expect([label, tr.querySelectorAll('[data-cell]').length]).toEqual([label, 14]);
      expect(tr.textContent).not.toMatch(/Not built yet/);
      expect(tl.querySelector(`[data-cell="${key}:2026-08-31"]`)!.textContent?.trim()).toBe(value);
    }
    expect(tl.querySelectorAll('[data-cell]')).toHaveLength(6 * 14);
  });

  it('B25_the_P4_header_reads_Checked_not_Verifications', async () => {
    const tl = await shown();
    const heads = [...tl.querySelectorAll('table[aria-label="Activity by event type and day"] tbody th[scope="row"]')].map((h) => (h.firstChild?.textContent ?? '').trim());
    expect(heads).toEqual(['Started', 'Submitted', 'Proof', 'Summary', 'Checked', 'Errors']);
    expect(tl.textContent).not.toMatch(/Verifications/);
  });
});

describe('the one-farm page loading states (B25, A32)', () => {
  it('B25_while_loading_there_are_two_NAMED_busy_states_not_identical_ones', async () => {
    stub = installAdapter(async (req) => {
      if (req.url.includes('/me/scope')) return { status: 200, data: scope };
      return neverSettles();
    });
    mount();
    await screen.findByRole('status', { name: 'Loading 14-day timeline' }, WAIT);
    const names = screen.getAllByRole('status').map((n) => n.getAttribute('aria-label'));
    expect([...names].sort()).toEqual(['Loading 14-day timeline', 'Loading last entry']);
    for (const label of names) expect(screen.getByRole('status', { name: label! })).toHaveAttribute('aria-busy', 'true');
    expect(within(document.body).queryByRole('status', { name: 'Loading DWC score' })).toBeNull();
  });
});
