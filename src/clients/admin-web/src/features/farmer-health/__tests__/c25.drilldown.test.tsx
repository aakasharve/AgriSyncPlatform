import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import FarmerHealthDrilldown from '../FarmerHealthDrilldown';

/**
 * CR-2e C25 (main-session amendment), page part, items (3), (4) and (6).
 * Written from the spec alone: a null block says "not measured" with a reason
 * instead of vanishing; the Checked and Errors row tooltips say what is
 * counted; a null phone says "Phone not recorded".
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = '22222222-2222-2222-2222-222222222222';
const WAIT = { timeout: 15_000 };

function days() {
  const d = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 7, 18 + i)).toISOString().slice(0, 10),
    closuresStarted: 0, closuresSubmitted: 0, proofAttached: 0, summariesViewed: 0, verifications: 0, errors: 0,
  }));
  d[12] = { ...d[12], closuresStarted: 4, verifications: 7, errors: 5 };
  return d;
}

function answer(over: Record<string, unknown> = {}) {
  return {
    farmId: FARM,
    farmerName: 'Zzowner Unique',
    farmName: 'Zzfarm Unique Mala',
    phone: '9000000033',
    score: null,
    timeline: days(),
    syncState: { lastSyncAt: '2026-08-30T09:05:00.0000000Z' },
    aiHealth: {
      voice: { finishedJobs14d: 23, savedJobs14d: 19, savedPct14d: 82.6, notMeasuredReason: null },
      receipt: { finishedJobs14d: 11, savedJobs14d: null, savedPct14d: null, notMeasuredReason: 'saved_not_recorded' },
      patti: { finishedJobs14d: 4, savedJobs14d: null, savedPct14d: null, notMeasuredReason: 'saved_not_recorded' },
    },
    verifications: { confirmed: 41, verified: 52, disputed: 3, pending: 19, selfChecked: 67 },
    workerSummary: [{ workerId: 'w-1', name: 'Zzworker First', assignmentCount: 29, firstSeenUtc: '2026-07-02T04:00:00.0000000Z' }],
    ...over,
  };
}

const scope = {
  outcome: 'Resolved',
  scope: {
    userId: 'u1', orgId: ORG, orgType: 'FPO', orgRole: 'Owner', isPlatformAdmin: true,
    modules: ['farmer.health', 'farms.list'].map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
  },
  memberships: [{ orgId: ORG, orgName: 'Nashik Grape FPO', orgType: 'FPO', orgRole: 'Owner' }],
};

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

async function shown(body: unknown) {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) return { status: 200, data: scope };
    if (req.url.includes('/admin/farmer-health/')) return { status: 200, data: body };
    return { status: 404, data: {} };
  });
  renderWithProviders(
    <Routes><Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} /></Routes>,
    { route: `/farmer-health/${FARM}?org=${ORG}` },
  );
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /^Loading/ })).toHaveLength(0), WAIT);
  await waitFor(() => expect(document.querySelector('[data-band="header"]')).not.toBeNull(), WAIT);
}

const metric = (key: string) => document.querySelector<HTMLElement>(`[data-metric="${key}"]`);
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');
const unmeasured = () => [...document.querySelectorAll<HTMLElement>('[data-state="unmeasured"]')];

describe('CR-2e C25 (main-session amendment): a null block is not measured, not gone', () => {
  it('verifications null shows a not-measured block about checks, with a reason, and no counts', async () => {
    await shown(answer({ verifications: null }));
    expect(metric('fh-verification-counts')).toBeNull();
    const blocks = unmeasured().filter((e) => /check/i.test(txt(e)));
    expect(blocks.length, 'a not-measured block about the checks').toBeGreaterThan(0);
    const t = txt(blocks[0]);
    expect(t.length, 'a reason beyond a bare title').toBeGreaterThan(40);
    expect(t).not.toMatch(/\b0\b/);
    // the reading block is untouched by this null
    expect(metric('fh-reading-rates')).not.toBeNull();
  });

  it('aiHealth null shows a not-measured block about reading, with a reason, and no figures', async () => {
    await shown(answer({ aiHealth: null }));
    expect(metric('fh-reading-rates')).toBeNull();
    expect(metric('fh-reading-count')).toBeNull();
    const blocks = unmeasured().filter((e) => /voice|photo|reading/i.test(txt(e)));
    expect(blocks.length, 'a not-measured block about reading').toBeGreaterThan(0);
    const t = txt(blocks[0]);
    expect(t.length, 'a reason beyond a bare title').toBeGreaterThan(40);
    expect(t).not.toMatch(/\b0\b|%/);
    // the checks block is untouched by this null
    expect(metric('fh-verification-counts')).not.toBeNull();
  });
});

describe('CR-2e C25 (main-session amendment): the row tooltips say what is counted', () => {
  async function tip(label: string) {
    await shown(answer());
    const th = [...document.querySelectorAll<HTMLElement>('[data-band="timeline"] th[scope="row"]')].find(
      (e) => txt(e).trim() === label,
    );
    expect(th, `${label} row header`).toBeDefined();
    return th!.getAttribute('title') ?? '';
  }

  it('Checked: a deliberate check, once per entry each day, self-checks left out', async () => {
    const t = await tip('Checked');
    expect(t).toMatch(/deliberate/i);
    expect(t).toMatch(/once per entry/i);
    expect(t).toMatch(/each day|per day|a day/i);
    expect(t).toMatch(/left out|excluded|not counted|leaves out/i);
    expect(t).not.toContain('verification.recorded');
  });

  it('Errors: problems on requests that named this farm, failed voice calls included', async () => {
    const t = await tip('Errors');
    expect(t).toMatch(/problems/i);
    expect(t).toMatch(/requests that named this farm/i);
    expect(t).toMatch(/failed voice calls/i);
    expect(t).not.toContain('api.error');
  });
});

describe('CR-2e C25 (main-session amendment): phone null', () => {
  it('shows Phone not recorded, never a blank or a made-up number', async () => {
    await shown(answer({ phone: null }));
    const p1 = metric('fh-name-phone')!;
    expect(txt(p1.querySelector('[data-field="phone"]'))).toBe('Phone not recorded');
    expect(p1.textContent).toContain('Zzfarm Unique Mala');
  });
});
