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

  // CR-2e C3|C20 (main-session amendment, citing B23 (founder, 2026-11-17)): the recent-events read no longer swallows failures. Retired: B25_an_empty_recent_events_list_shows_the_unproven_panel_never_a_measured_zero; replaced by OpsLivePage.repeated.test.tsx (empty answer is a plain none with its window; failed request is could not load).

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
  it('B25_an_alert_verdict_is_served_and_not_drawn', async () => {
    await shown(health({ apiErrorSpike: true, voiceDegraded: true }));
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): L1 became real. Retired: its Not built yet assertion; the checks are covered by OpsLivePage.alerts.test.tsx.
    // What stays: the old served flags (apiErrorSpike, voiceDegraded) are still never drawn as a verdict.
    const el = document.querySelector<HTMLElement>('[data-metric="live-alert-rules"]')!;
    expect(el).not.toBeNull();
    expect(el.textContent).not.toContain('Not built yet');
    expect(document.body.textContent).not.toContain('BREACH');
  });
});
