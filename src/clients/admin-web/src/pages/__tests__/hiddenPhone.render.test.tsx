import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub, type ContactsStub } from '@/test/contactsStub';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import FarmerHealthDrilldown from '@/features/farmer-health/FarmerHealthDrilldown';
import SilentChurnPage from '../farms/SilentChurnPage';
import HomePage from '../HomePage';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7; K29 the phone-renderer test; H4).
 *
 * The server sends the redaction marker for a farmer's phone number the caller has no tick for
 * (Task A4). That is a permission fact, so the console reads "Hidden for you" and never "Phone not
 * recorded", which says there is no number. Three renderers: Home's call list, Silent Churn, and
 * the farmer drilldown.
 */

const HIDDEN = '**redacted**';
const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = '22222222-2222-2222-2222-222222222222';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'w', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 0 };

let contacts: ContactsStub | null = null;
let adapter: StubbedAdapter | null = null;
afterEach(() => {
  contacts?.restore();
  adapter?.restore();
  contacts = null;
  adapter = null;
  localStorage.clear();
});

const silentFarm = (phone: string | null) => ({
  farmId: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Example: Hidden Phone Farm',
  ownerPhone: phone,
  band: '7-13',
  daysSilent: 9,
  lastEntryUtc: '2026-08-23T06:00:00Z',
  planCode: null,
  planStatus: null,
});

const scope = (...keys: string[]) => ({
  outcome: 'Resolved',
  scope: {
    userId: 'u1',
    orgId: ORG,
    orgType: 'Platform',
    orgRole: 'Employee',
    isPlatformAdmin: false,
    modules: keys.map((key) => ({ key, canRead: true, canExport: false, canWrite: false })),
  },
  memberships: [],
});

describe('A_hidden_phone_reads_hidden_for_you_not_phone_not_recorded', () => {
  it('on Silent Churn', async () => {
    contacts = installContactsStub((r) =>
      r.path.endsWith('/admin/farms/silent-churn')
        ? { data: { countedAtUtc: '2026-09-01T08:30:00Z', farms: [silentFarm(HIDDEN)], notMeasuredReason: null }, meta: META }
        : { data: null, meta: META },
    );
    renderWithProviders(<SilentChurnPage />, { route: `/farms/silent-churn?org=${ORG}` });

    const row = (await screen.findByText('Example: Hidden Phone Farm', undefined, SETTLE)).closest('tr')!;
    expect(row.textContent).toContain('Hidden for you');
    expect(row.textContent).not.toContain('Phone not recorded');
    expect(row.textContent).not.toContain(HIDDEN);
  });

  it('on Silent Churn, a number the server really has none of still says "Phone not recorded"', async () => {
    contacts = installContactsStub((r) =>
      r.path.endsWith('/admin/farms/silent-churn')
        ? { data: { countedAtUtc: '2026-09-01T08:30:00Z', farms: [silentFarm(null)], notMeasuredReason: null }, meta: META }
        : { data: null, meta: META },
    );
    renderWithProviders(<SilentChurnPage />, { route: `/farms/silent-churn?org=${ORG}` });

    const row = (await screen.findByText('Example: Hidden Phone Farm', undefined, SETTLE)).closest('tr')!;
    expect(row.textContent).toContain('Phone not recorded');
    expect(row.textContent).not.toContain('Hidden for you');
  });

  it('on Home', async () => {
    contacts = installContactsStub((r) => {
      if (r.path.endsWith('/me/scope')) return scope('farms.silent-churn', 'farms.suffering');
      if (r.path.endsWith('/admin/farms/silent-churn')) {
        return { data: { countedAtUtc: '2026-09-01T08:30:00Z', farms: [silentFarm(HIDDEN)], notMeasuredReason: null }, meta: META };
      }
      return { data: null, meta: META };
    });
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}` });

    await waitFor(() => expect(document.querySelector('[data-metric="home-call-list"]')).not.toBeNull(), SETTLE);
    await waitFor(
      () => expect(document.querySelector('[data-metric="home-call-list"]')!.textContent).toContain('Hidden for you'),
      SETTLE,
    );
    const list = document.querySelector('[data-metric="home-call-list"]')!;
    expect(list.textContent).not.toContain('Phone not recorded');
    expect(list.textContent).not.toContain('Phone not fetched');
    expect(list.textContent).not.toContain(HIDDEN);
  });

  it('on the farmer drilldown', async () => {
    adapter = installAdapter(async (req) => {
      if (req.url.includes('/me/scope')) return { status: 200, data: scope('farmer.health') };
      if (req.url.includes('/admin/farmer-health/')) {
        return {
          status: 200,
          data: {
            farmId: FARM,
            farmerName: 'Example: Owner',
            farmName: 'Example: Farm',
            phone: HIDDEN,
            score: null,
            timeline: [],
            syncState: { lastSyncAt: null },
            aiHealth: null,
            verifications: null,
            workerSummary: [],
          },
        };
      }
      return { status: 404, data: {} };
    });
    renderWithProviders(
      <Routes>
        <Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} />
      </Routes>,
      { route: `/farmer-health/${FARM}?org=${ORG}` },
    );

    await waitFor(() => expect(document.querySelector('[data-field="phone"]')).not.toBeNull(), SETTLE);
    const phone = document.querySelector('[data-field="phone"]')!;
    expect(phone.textContent).toContain('Hidden for you');
    expect(phone.textContent).not.toContain('Phone not recorded');
    expect(phone.textContent).not.toContain(HIDDEN);
  });
});
