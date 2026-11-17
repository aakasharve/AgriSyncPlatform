import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import type { OpsHealthData } from '@/hooks/useOpsHealth';
import OpsLivePage from '../OpsLivePage';

/**
 * B25 (2026-11-17), Live Health. B24 retired three real behaviours together with the doubles and ideas
 * beside them; they are asserted again here, plus the ideas stay ideas when the server answers with values,
 * and the R1-R8 description row is back (with no value).
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const SEVEN_MINUTES_AGO = new Date(Date.now() - 7 * 60_000).toISOString();
const WAIT = { timeout: 15_000 };

function health(over: Partial<OpsHealthData> = {}): OpsHealthData {
  return {
    voiceInvocations24h: 1402, voiceFailures24h: 56, voiceFailureRatePct: 4,
    voiceAvgLatencyMs: 980, voiceP95LatencyMs: 2100,
    recentErrors: [], topSufferingFarms: [],
    apiErrorSpike: false, voiceDegraded: false,
    computedAtUtc: SEVEN_MINUTES_AGO,
    ...over,
  };
}

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

async function shown(data: OpsHealthData) {
  // The endpoint sends the DTO bare, with no envelope.
  stub = installAdapter(async () => ({ status: 200, data }));
  renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Loading/ })).toHaveLength(0), WAIT);
  await waitFor(() => expect(document.querySelector('.chip-fresh')).not.toBeNull(), WAIT);
}

describe('Live Health real behaviours (B25)', () => {
  it('B25_the_freshness_chip_states_the_servers_age_not_the_browsers', async () => {
    await shown(health());
    // computedAtUtc is seven minutes old; this browser received the answer a moment ago.
    const chip = document.querySelector('.chip-fresh')!;
    expect(chip.textContent).toContain('7m ago');
    expect(chip.textContent).not.toContain('now');
  });

  it('B25_an_empty_recent_events_list_shows_the_unproven_panel_never_a_measured_zero', async () => {
    await shown(health({ recentErrors: [] }));
    const events = document.querySelector<HTMLElement>('[data-list="ops-live-events"]')!;
    expect(events).not.toBeNull();
    expect(events.querySelector('[data-state="unmeasured"]')).not.toBeNull();
    expect(events.textContent).toMatch(/a broken query and a genuinely quiet two hours arrive here looking the same/i);
    expect(document.body.textContent).not.toContain('This is a measured zero');
    expect(screen.queryByRole('table', { name: 'Recent events' })).toBeNull();
  });

  it('B25_the_R1_to_R8_row_is_present_on_the_service_list_and_carries_no_value', async () => {
    await shown(health());
    const table = screen.getByRole('table', { name: 'Feeds this console depends on' });
    const row = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')]
      .find((tr) => /alert_r1/i.test(tr.textContent ?? '') && /r8/i.test(tr.textContent ?? ''));
    expect(row, 'R1-R8 row').toBeTruthy();
    const cells = [...row!.querySelectorAll('td')];
    expect(cells).toHaveLength(4);
    // the last-heard cell holds no value: it is the named unmeasured mark, never a time
    expect(cells[3].querySelector('[data-state="unmeasured"]')).not.toBeNull();
    expect(cells[3].textContent).not.toMatch(/\d/);
    expect(row!.textContent).not.toMatch(/\bCLEAR\b|\bBREACH\b/);
    // and the four rows that showed values from doubles or ideas stay out
    const names = [...table.querySelectorAll('tbody > tr[aria-controls] td:first-child')].map((c) => c.textContent ?? '');
    expect(names).toHaveLength(4);
  });
});

describe('Live Health ideas stay ideas when the server serves a value (B25)', () => {
  it('B25_an_alert_verdict_and_a_24_hour_farm_list_are_served_and_neither_is_drawn', async () => {
    await shown(health({
      apiErrorSpike: true,
      voiceDegraded: true,
      topSufferingFarms: [
        { farmId: 'bbbbbbbb-0000-0000-0000-000000000002', errorCount: 7733, syncErrors: 7741, logErrors: 7751, voiceErrors: 7753, lastErrorAt: '2026-09-01T11:38:00.0000000Z' },
      ],
    }));
    // Both ideas are on the page as "Not built yet", each with no value.
    for (const key of ['live-alert-rules', 'live-suffering-24h']) {
      const el = document.querySelector<HTMLElement>(`[data-metric="${key}"]`)!;
      expect(el, key).not.toBeNull();
      expect(el.textContent).toContain('Not built yet');
    }
    // The verdict: no BREACH or CLEAR badge and no rule badge element.
    expect(document.querySelector('[data-rule]')).toBeNull();
    expect(document.body.textContent).not.toContain('BREACH');
    // The farm list: no row, no id, none of its counts.
    expect(screen.queryByRole('table', { name: 'Farmer suffering watchlist' })).toBeNull();
    const t = document.body.textContent ?? '';
    expect(t).not.toContain('bbbbbbbb');
    for (const n of ['7733', '7741', '7751', '7753']) expect(t, n).not.toContain(n);
  });
});
