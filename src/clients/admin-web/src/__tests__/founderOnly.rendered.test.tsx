import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { ModuleKeys } from '@/lib/moduleKeys';
import { authStore } from '@/lib/auth';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7; K29, fix round 1).
 *
 * `FounderOnly` rendered, through the whole `<App />` with only the wire stubbed: a team seat that
 * holds EVERY module key still never gets People and access or History, and the founder does.
 */

const WAIT = { timeout: 15_000 };
const SENTENCE = 'This part is not open for you. Ask Akash if you need it.';
const SESSION = {
  accessToken: 'token-123',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000aa',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
  signedInAtUtc: new Date(Date.now()).toISOString(),
};

function scope(isPlatformAdmin: boolean) {
  return {
    outcome: 'Resolved',
    scope: {
      userId: SESSION.userId,
      orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      orgType: 'Platform',
      orgRole: isPlatformAdmin ? 'Owner' : 'Employee',
      isPlatformAdmin,
      modules: Object.values(ModuleKeys).map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
    },
    memberships: [],
    controlRoom: {
      isFounder: isPlatformAdmin,
      startingRole: isPlatformAdmin ? null : 'admin',
      ticks: [],
      doorSessionRequired: false,
    },
  };
}

const PEOPLE = {
  people: [],
  ticks: [{ key: 'company_numbers', isPersonalData: false }],
  presets: { admin: [], field_operator: [], viewer: [] },
};
const REPORT = {
  countedAtUtc: '2026-11-20T10:00:00Z',
  peopleWithAccess: 0,
  peopleByRole: {},
  phoneLooks: { value: 0, notMeasuredReason: null },
  phoneFarms: { value: 0, notMeasuredReason: null },
  phoneLookers: { value: 0, notMeasuredReason: null },
  downloads: { value: null, notMeasuredReason: 'downloads_start_with_field_visits' },
  downloadFarmRows: { value: null, notMeasuredReason: 'downloads_start_with_field_visits' },
  downloaders: { value: null, notMeasuredReason: 'downloads_start_with_field_visits' },
  notSignedIn30Days: [],
  notSignedInNotMeasuredReason: null,
  refusedAtDoor: { value: 0, notMeasuredReason: null },
};

let stub: StubbedAdapter | null = null;

function serve(isPlatformAdmin: boolean) {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/admin/me/scope')) return { status: 200, data: scope(isPlatformAdmin) };
    if (req.url.includes('/people/trust-report')) return { status: 200, data: REPORT };
    if (req.url.includes('/people/history')) return { status: 200, data: { lines: [], hitLimit: false, limit: 500 } };
    if (req.url.includes('/admin/people')) return { status: 200, data: PEOPLE };
    return { status: 200, data: { data: [], meta: { source: 'live', window: '', lastRefreshedUtc: null, ttlSeconds: 0 } } };
  });
}

const at = () => window.location.pathname;
const go = (url: string) => window.history.replaceState({}, '', url);
const peopleRequests = () => stub!.requests.filter((r) => r.url.includes('/admin/people'));

afterEach(() => {
  stub?.restore();
  stub = null;
  authStore.clear();
  const tree = App() as ReactElement;
  (tree.props as { client: QueryClient }).client.clear();
});

describe('People and access and History are the founder\'s only (K29)', () => {
  it.each(['/people', '/people/history'])(
    'a team seat holding every module key opening %s sees the no-access sentence and no People request is sent',
    async (route) => {
      authStore.set(SESSION);
      serve(false);
      go(route);
      render(<App />);

      expect(await screen.findByText(SENTENCE, undefined, WAIT)).toBeInTheDocument();
      expect(at()).toBe('/403');
      expect(screen.queryByRole('heading', { name: 'People and access' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();
      expect(peopleRequests()).toHaveLength(0);
    },
  );

  it('the founder opening /people reaches the People page', async () => {
    authStore.set(SESSION);
    serve(true);
    go('/people');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'People and access' }, WAIT)).toBeInTheDocument();
    expect(at()).toBe('/people');
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });
});
