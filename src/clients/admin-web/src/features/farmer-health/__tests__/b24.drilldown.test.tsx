import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import FarmerHealthDrilldown from '../FarmerHealthDrilldown';

/**
 * B24 (founder, 2026-11-17) — the one-farm page. The feed still arrives and still carries every
 * old value, but the page draws only P3 (14-day timeline: started, submitted, proof, summary) and
 * P8 (labelled "Last entry reached the server"). P1, P2, P4 to P7, P9 to P11 are ideas: no value from
 * the answer reaches the screen. The block once titled "AI health" is now "Voice and photo reading".
 */

interface Entry { page: string; label: string; status: string; buildId: string; what?: string; why?: string }
const ENTRIES = (JSON.parse(raw) as Entry[]).filter((e) => e.page.startsWith('Farmer Health drilldown'));
const byId = (id: string) => ENTRIES.find((e) => e.buildId === id)!;

const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = '22222222-2222-2222-2222-222222222222';
const WAIT = { timeout: 15_000 };

const days = Array.from({ length: 14 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 18 + i)).toISOString().slice(0, 10),
  closuresStarted: 0, closuresSubmitted: 0, proofAttached: 0, summariesViewed: 0, verifications: 0, errors: 0,
}));
days[12] = { ...days[12], closuresStarted: 4, closuresSubmitted: 3 };
days[13] = { ...days[13], closuresStarted: 1, verifications: 8383, errors: 9797 };

const ANSWER = {
  farmId: FARM,
  farmerName: 'Zzfarmer Unique',
  phone: '98******12',
  score: {
    total: 58, bucket: 'watchlist', flag: 'ok', weekStart: '2026-08-24',
    pillars: { triggerFit: 6.4, actionSimplicity: 14, proof: 9.5, reward: 3.2, investment: 0, repeat: 25 },
  },
  timeline: days,
  syncState: {
    lastSyncAt: '2026-08-30T09:05:00.0000000Z', pendingPushes: 0, failedPushesLast7d: 6143,
    lastErrors: [{ ts: '2026-08-30T08:00:00Z', endpoint: '/sync/push', status: 500, message: 'zzboom' }],
  },
  aiHealth: { voiceParseSuccessRate14d: 0.94, receiptParseSuccessRate14d: 0.71, invocationCount14d: 3333 },
  verifications: { confirmed: 4151, verified: 4252, disputed: 4454, pending: 4555 },
  workerSummary: [{ workerId: 'w-1', name: 'Zzworker Name', assignmentCount: 7717, firstSeenUtc: '2026-07-02T04:00:00.0000000Z' }],
};

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve() {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) {
      return {
        status: 200,
        data: {
          outcome: 'Resolved',
          scope: {
            userId: 'u1', orgId: ORG, orgType: 'FPO', orgRole: 'Owner', isPlatformAdmin: false,
            modules: ['farmer.health', 'ops.errors', 'ops.voice'].map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
          },
          memberships: [{ orgId: ORG, orgName: 'Nashik Grape FPO', orgType: 'FPO', orgRole: 'Owner' }],
        },
      };
    }
    if (req.url.includes('/admin/farmer-health/')) return { status: 200, data: ANSWER };
    return { status: 404, data: {} };
  });
}

async function shown() {
  serve();
  renderWithProviders(
    <Routes>
      <Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} />
    </Routes>,
    { route: `/farmer-health/${FARM}?org=${ORG}` },
  );
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /^Loading/ })).toHaveLength(0), WAIT);
  await waitFor(() => expect(document.body.textContent).toContain('Not built yet'), WAIT);
}

describe('the one-farm page after B24', () => {
  it('B24_still_calls_its_drilldown_feed_once', async () => {
    await shown();
    expect((stub?.requests ?? []).filter((r) => r.url.includes('/admin/farmer-health/'))).toHaveLength(1);
  });

  it('B24_idea_values_from_the_answer_are_never_drawn', async () => {
    await shown();
    const t = document.body.textContent ?? '';
    // P1 name and phone, P2 score and parts, P4 checked and P5 errors per day, P6 checks, P7 workers,
    // P9 refused uploads, P10 and P11 reading rates and counts. Each marker is unique to the answer above.
    for (const v of ['Zzfarmer Unique', '98******12', 'Zzworker Name', 'zzboom', '/sync/push', '94%', '71%', '0.94', '0.71']) {
      expect(t, v).not.toContain(v);
    }
    for (const n of ['8383', '9797', '6143', '4151', '4252', '4454', '4555', '7717', '3333']) expect(t, `digit run ${n}`).not.toMatch(new RegExp(`(^|\\D)${n}(\\D|$)`));
  });

  it('B24_each_idea_shows_Not_built_yet_with_its_two_lines', async () => {
    await shown();
    const t = document.body.textContent ?? '';
    for (const id of ['P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P9', 'P10', 'P11']) {
      const e = byId(id);
      expect(t, `${id} label`).toContain(e.label);
      expect(t, `${id} what`).toContain(e.what!);
      expect(t, `${id} why`).toContain(e.why!);
    }
  });

  it('B24_the_AI_health_block_is_now_Voice_and_photo_reading', async () => {
    await shown();
    const t = document.body.textContent ?? '';
    expect(t).toContain('Voice and photo reading');
    expect(t).not.toMatch(/AI health/i);
    expect(t).not.toMatch(/\bAI\b/);
  });

  it('B24_real_parts_P3_and_P8_keep_their_values_and_gain_their_lines', async () => {
    await shown();
    const t = document.body.textContent ?? '';
    for (const id of ['P3', 'P8']) {
      const e = byId(id);
      expect(t, `${id} what`).toContain(e.what!);
      expect(t, `${id} why`).toContain(e.why!);
    }
    expect(t).toContain('Last entry reached the server');
    expect(t).not.toContain('Last activity');
    // B25: P8's value is asserted on P8's own element, not on the whole page (the timeline's own dates
    // also say "Aug"). The feed's lastSyncAt is 30 Aug 2026, in whatever date form the console uses.
    const p8 = document.querySelector<HTMLElement>('section[aria-label="Last entry reached the server"]');
    expect(p8, 'P8 element').not.toBeNull();
    expect(p8!.textContent).toMatch(/30 Aug|Aug 30|30\/08|30-08|2026-08-30/);
    expect(p8!.textContent).not.toMatch(/not measured|not built yet/i);
    // P3: the four timeline rows are still there
    const timeline = document.querySelector<HTMLElement>('[data-band="timeline"]');
    expect(timeline).not.toBeNull();
    for (const row of ['Started', 'Submitted', 'Proof', 'Summary']) expect(timeline!.textContent).toContain(row);
  });

  it('B24_timeline_columns_P4_Checked_and_P5_Errors_carry_the_mark', async () => {
    await shown();
    const timeline = document.querySelector<HTMLElement>('[data-band="timeline"]')!;
    expect(timeline.textContent).toContain(byId('P4').label);
    expect(timeline.textContent).toContain(byId('P5').label);
    expect(timeline.textContent).toContain('Not built yet');
  });
});
