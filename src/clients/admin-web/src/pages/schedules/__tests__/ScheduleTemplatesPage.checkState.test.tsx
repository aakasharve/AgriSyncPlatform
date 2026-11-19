import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import type { ScheduleTemplate } from '@/hooks/useScheduleTemplates';
import ScheduleTemplatesPage from '../ScheduleTemplatesPage';

/**
 * spec: company-mis-real-numbers-2026-11-15 (plan CR-2d, D3: "the go-live line's own tests for
 * those pages" is deleted, there are none, and replaced by `Templates_page_shows_check_state`).
 * Written by the test-writer from the plan and the go-live line's page.
 *
 * D3: the templates page keeps the pages lane's structure PLUS the go-live line's check state and
 * its `/schedules/check` links. On the go-live line (`task/pre-launch-repair-d10-redesign`,
 * `ScheduleTemplatesPage.tsx`) each row reads, from its `check` and `hasStoredDays`:
 *
 *   Checked                 "Checked", and the checker's name when the server sends one
 *   Returned                "Returned"
 *   Withdrawn               "Withdrawn"
 *   no check, days stored   "Not checked"
 *   no check, no days       "Not checkable (days not stored)"
 *
 * The header links to the check page ("Schedules waiting for a check"), and each row that stores
 * its days links to the check page for that row ("Open in the check page", `?id=<row id>`).
 * Every value below is made up.
 */

const WAIT = 15_000;

function row(id: string, name: string, over: Partial<ScheduleTemplate>): ScheduleTemplate {
  return {
    id,
    name,
    cropType: name.split(' - ')[0],
    totalDays: 120,
    stages: [{ name: 'Fake Stage', startDay: 0, endDay: 119 }],
    activities: [
      {
        name: 'Fake Activity',
        category: 'Spraying',
        stageName: 'Fake Stage',
        startDay: 3,
        endDay: 3,
        frequencyMode: 'one_time',
        intervalDays: null,
      },
    ],
    versionHash: 'fakehash0001',
    ownerType: 'EXPERT',
    sourceLabel: 'Fake Source Label',
    rowVersionTag: 'v2',
    ...over,
  } as ScheduleTemplate;
}

const CHECKED = 'c0000000-0000-4000-8000-000000000001';
const RETURNED = 'c0000000-0000-4000-8000-000000000002';
const WITHDRAWN = 'c0000000-0000-4000-8000-000000000003';
const NOT_CHECKED = 'c0000000-0000-4000-8000-000000000004';
const NOT_CHECKABLE = 'c0000000-0000-4000-8000-000000000005';

const ROWS: ScheduleTemplate[] = [
  row(CHECKED, 'Fakefruit - Checked Template', {
    hasStoredDays: true,
    check: { state: 'Checked', checkerDisplayName: 'Fake Checker Name', checkedAtUtc: '2026-11-18T06:00:00Z', note: null },
  }),
  row(RETURNED, 'Fakeleaf - Returned Template', {
    hasStoredDays: true,
    check: { state: 'Returned', checkerDisplayName: 'Fake Checker Name', checkedAtUtc: '2026-11-18T06:00:00Z', note: 'Fake note' },
  }),
  row(WITHDRAWN, 'Fakeroot - Withdrawn Template', {
    hasStoredDays: true,
    check: { state: 'Withdrawn', checkerDisplayName: 'Fake Checker Name', checkedAtUtc: '2026-11-18T06:00:00Z', note: null },
  }),
  row(NOT_CHECKED, 'Fakeseed - Unchecked Template', { hasStoredDays: true, check: null }),
  row(NOT_CHECKABLE, 'Fakestem - Sample Template', { hasStoredDays: false, check: null }),
];

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

function card(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-template="${id}"]`);
  if (!element) throw new Error(`no card for ${id}`);
  return element;
}

describe('the templates page carries the go-live line check state (D3)', () => {
  it('Templates_page_shows_check_state', async () => {
    stub = installAdapter(async () => ({ status: 200, data: ROWS }));
    renderWithProviders(<ScheduleTemplatesPage />, { route: '/schedules/templates' });

    await screen.findByText('Fakefruit - Checked Template', undefined, { timeout: WAIT });

    // Each row's check state, in the go-live line's words.
    expect(within(card(CHECKED)).getByText(/^Checked/)).toBeInTheDocument();
    expect(within(card(CHECKED)).getByText('Fake Checker Name')).toBeInTheDocument();
    expect(within(card(RETURNED)).getByText('Returned')).toBeInTheDocument();
    expect(within(card(WITHDRAWN)).getByText('Withdrawn')).toBeInTheDocument();
    expect(within(card(NOT_CHECKED)).getByText('Not checked')).toBeInTheDocument();
    expect(within(card(NOT_CHECKABLE)).getByText('Not checkable (days not stored)')).toBeInTheDocument();

    // The checker is named only on a row that is checked.
    for (const id of [RETURNED, WITHDRAWN]) {
      expect(within(card(id)).queryByText('Fake Checker Name')).not.toBeInTheDocument();
    }

    // The way into the check page from the header.
    expect(screen.getByRole('link', { name: /Schedules waiting for a check/ })).toHaveAttribute(
      'href',
      '/schedules/check',
    );

    // Each row that stores its days links to the check page for that row; the one that does not, does not.
    for (const id of [CHECKED, RETURNED, WITHDRAWN, NOT_CHECKED]) {
      expect(within(card(id)).getByRole('link', { name: 'Open in the check page' })).toHaveAttribute(
        'href',
        `/schedules/check?id=${id}`,
      );
    }
    expect(within(card(NOT_CHECKABLE)).queryByRole('link', { name: 'Open in the check page' })).not.toBeInTheDocument();

    // The row's own version and source, the go-live line's two other per-row fields (D3's hook type).
    expect(within(card(NOT_CHECKED)).getByText('v2')).toBeInTheDocument();
    expect(within(card(NOT_CHECKED)).getByText('Fake Source Label')).toBeInTheDocument();
  });
});
