import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { ControlRoomScope, MeScopeResponse } from '@/hooks/useAdminScope';
import { ModuleKeys } from '@/lib/moduleKeys';
import SettingsAdminsPage from '../SettingsAdminsPage';

/**
 * MY ACCESS (CR-3, Task A7; D-155) — what was "Settings".
 *
 * CHANGED WITH THE PAGE. The old file pinned a screen about where admin access came from (the
 * config allow-list, a bridge seeder, a "no admin list to show" panel). That whole screen is gone:
 * the console now has a real list of who may sign in (People and access, founder only) and this
 * page is only what the signed-in person holds, in plain words. The claims kept from the old file:
 *
 *  1. NO HARDCODED ROW. No account id, phone number or green "Active" pill is printed as if it were
 *     data, and there is no table.
 *  2. IT READS THE ANSWER THE CONSOLE ALREADY HAS (`/admin/me/scope`), and a failed answer is a
 *     failure with a retry, never an empty "you have no access".
 *  3. IT NEVER LOOKS LIKE A ROSTER.
 *
 * New: the founder sees "Founder: everything" and a way to People and access; a team seat sees its
 * role and each tick it holds; K20: the visit and download ticks say when they start to work.
 */

const SETTLE_WAIT = 15_000;
const ORG = '11111111-1111-1111-1111-111111111111';

function scopeBody(over: Partial<MeScopeResponse> = {}, isPlatformAdmin = false): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'aaaaaaaa-0000-0000-0000-000000000001',
      orgId: ORG,
      orgType: 'Platform',
      orgRole: isPlatformAdmin ? 'Owner' : 'Employee',
      isPlatformAdmin,
      modules: [
        { key: ModuleKeys.FarmsList, canRead: true, canExport: false, canWrite: false },
        { key: ModuleKeys.OpsErrors, canRead: false, canExport: false, canWrite: false },
      ],
    },
    memberships: [
      { orgId: ORG, orgName: 'AgriSync Platform', orgType: 'Platform', orgRole: isPlatformAdmin ? 'Owner' : 'Employee' },
    ],
    ...over,
  };
}

const teamSeat = (ticks: string[], startingRole = 'field_operator'): ControlRoomScope => ({
  isFounder: false,
  startingRole,
  ticks,
  doorSessionRequired: false,
});

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serveScope(body: MeScopeResponse) {
  stub = installAdapter(async () => ({ status: 200, data: body }));
  return stub;
}

const render = () => renderWithProviders(<SettingsAdminsPage />, { route: `/settings/admins?org=${ORG}` });

describe('My access: the founder', () => {
  it('says "Founder: everything" and links to People and access', async () => {
    serveScope(scopeBody({ controlRoom: { isFounder: true, startingRole: null, ticks: [], doorSessionRequired: false } }, true));
    render();

    expect(await screen.findByText('Founder: everything', undefined, { timeout: SETTLE_WAIT })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My access' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'People and access' });
    expect(link).toHaveAttribute('href', '/people');
  });
});

describe('My access: a team seat', () => {
  it('lists the ticks it holds, in plain words, and nothing it does not hold', async () => {
    serveScope(scopeBody({ controlRoom: teamSeat(['farms_to_call', 'farmer_health'], 'admin') }));
    render();

    expect(await screen.findByText('Farms that need a call', undefined, { timeout: SETTLE_WAIT })).toBeInTheDocument();
    expect(screen.getByText('Farmer health')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Founder: everything')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'People and access' })).not.toBeInTheDocument();
    expect(screen.getByText('Anything not listed here is not open for you. Ask Akash if you need it.')).toBeInTheDocument();
  });

  it('Visit_and_download_ticks_say_they_work_when_field_visits_arrive (My access)', async () => {
    serveScope(scopeBody({ controlRoom: teamSeat(['my_visits', 'downloads', 'farmer_phones']) }));
    render();
    const NOTE = 'Works when field visits arrive (about 5-8 Dec)';

    await screen.findByText('My visits', undefined, { timeout: SETTLE_WAIT });
    const item = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
    expect(within(item('My visits')).getByText(NOTE)).toBeInTheDocument();
    expect(within(item('Downloads')).getByText(NOTE)).toBeInTheDocument();
    expect(within(item("Farmers' phone numbers")).queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('My_access_speaks_to_the_reader', async () => {
    serveScope(scopeBody({ controlRoom: teamSeat(['farmer_phones', 'downloads', 'my_visits', 'users']) }));
    render();
    await screen.findByText("Farmers' phone numbers", undefined, { timeout: SETTLE_WAIT });
    const item = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
    // The same meaning, in the second person, and labels exactly as in the add panel.
    expect(within(item("Farmers' phone numbers")).getByText("Lets you see and call farmers' numbers. Each look is recorded.")).toBeInTheDocument();
    expect(within(item('Users')).getByText('Lets you see the list of app users.')).toBeInTheDocument();
    expect(within(item('My visits')).getByText(/^Lets you see only your own visits/)).toBeInTheDocument();
    // No founder instructions and no third person.
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Off until you tick it/);
    expect(text).not.toMatch(/Lets them/);
    expect(text).not.toMatch(/the downloader's name/);
  });

  it('says so, and does not invent a part, when no tick is held', async () => {
    serveScope(scopeBody({ controlRoom: teamSeat([], 'viewer') }));
    render();
    expect(
      await screen.findByText('No other part is open for you yet. Ask Akash if you need one.', undefined, {
        timeout: SETTLE_WAIT,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});

describe('My access: everyone else who got in', () => {
  it('a farm organisation seat sees a count, not a made-up list', async () => {
    serveScope(scopeBody({ controlRoom: null }));
    render();
    expect(
      await screen.findByText(/Your access comes from your organisation\. 1 part is open to you\./, undefined, {
        timeout: SETTLE_WAIT,
      }),
    ).toBeInTheDocument();
  });
});

describe('no hardcoded row, no table, no roster (claims kept from the old page)', () => {
  it('renders no table, no Active pill and no seeded id or phone', async () => {
    serveScope(scopeBody({ controlRoom: teamSeat(['farmer_health']) }));
    render();
    await screen.findByText('Farmer health', undefined, { timeout: SETTLE_WAIT });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByText('00000000-0000-0000-0000-000000000099')).not.toBeInTheDocument();
    expect(screen.queryByText('0000000000')).not.toBeInTheDocument();
    expect(screen.queryByText(/Seeded admin/)).not.toBeInTheDocument();
    // The old developer copy about where admin access comes from is gone with the password way.
    expect(screen.queryByText(/allow-list|bridge|PlatformAdminBridgeSeeder|Phase 6/i)).not.toBeInTheDocument();
  });
});

describe('loading and failing', () => {
  it('a scope still loading says it is loading, not "no access"', async () => {
    stub = installAdapter(neverSettles);
    render();
    expect(await screen.findByRole('status', { name: /Loading your access/ }, { timeout: SETTLE_WAIT })).toBeInTheDocument();
    expect(screen.queryByText(/No other part is open/)).not.toBeInTheDocument();
  });

  it('a failed scope is a failure with a retry, never an empty page', async () => {
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    render();
    expect(await screen.findByRole('button', { name: /retry|try again/i }, { timeout: SETTLE_WAIT })).toBeInTheDocument();
    expect(screen.queryByText('Founder: everything')).not.toBeInTheDocument();
  });
});
