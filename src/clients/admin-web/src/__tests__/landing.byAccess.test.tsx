import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { endSession } from '@/lib/api';
import { signedOutNotice } from '@/lib/signInMessages';
import { ModuleKeys } from '@/lib/moduleKeys';
import { authStore } from '@/lib/auth';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';

// `endSession` is the one export replaced: ending a session loads a new page, which a test cannot
// do. Everything else in the module (the interceptors, the stores) is the real one. How a real end
// of session opens /login?signedOut=door-required is pinned in
// src/test/lib/api.requests.door-session-required.test.ts.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, endSession: vi.fn(async () => undefined) };
});

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7; D-155 landing rule, H10, K24).
 *
 * Where a person lands when they open the console, by what they are allowed to open. The whole
 * `<App />` is rendered with only the wire stubbed, in the shapes Task A3 pins for
 * `/admin/me/scope` (`controlRoom` is additive).
 */

const WAIT = 15_000;
const SESSION = {
  accessToken: 'token-123',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000aa',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
  signedInAtUtc: new Date(Date.now()).toISOString(),
};

type Module = { key: string; canRead: boolean; canWrite: boolean; canExport: boolean };
const readOnly = (...keys: string[]): Module[] =>
  keys.map((key) => ({ key, canRead: true, canWrite: false, canExport: false }));

interface ScopeOptions {
  modules?: Module[];
  isPlatformAdmin?: boolean;
  outcome?: 'Resolved' | 'Unauthorized';
  controlRoom?: unknown;
}

function scopeBody({ modules = [], isPlatformAdmin = false, outcome = 'Resolved', controlRoom }: ScopeOptions) {
  return {
    outcome,
    scope:
      outcome === 'Resolved'
        ? {
            userId: SESSION.userId,
            orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            orgType: 'Platform',
            orgRole: isPlatformAdmin ? 'Owner' : 'Employee',
            isPlatformAdmin,
            modules,
          }
        : null,
    memberships: [],
    controlRoom: controlRoom ?? null,
  };
}

const envelope = (data: unknown) => ({
  data,
  meta: { source: 'live', window: '24h', lastRefreshedUtc: new Date().toISOString(), ttlSeconds: 60 },
});

let stub: StubbedAdapter | null = null;

function server(options: ScopeOptions) {
  stub = installAdapter(async (req: CapturedRequest) => {
    if (req.url.includes('/admin/me/scope')) return { status: 200, data: scopeBody(options) };
    return { status: 200, data: envelope({ items: [], totalCount: 0, page: 1, pageSize: 40 }) };
  });
  return stub;
}

function appQueryClient(): QueryClient {
  const tree = App() as ReactElement;
  return (tree.props as { client: QueryClient }).client;
}

const at = () => window.location.pathname + window.location.search;
const go = (url: string) => window.history.replaceState({}, '', url);

afterEach(() => {
  stub?.restore();
  stub = null;
  appQueryClient().clear();
  authStore.clear();
  vi.mocked(endSession).mockClear();
});

function signedIn() {
  authStore.set(SESSION);
}

describe('where "/" lands, by what the person may open', () => {
  it('Root_sends_a_person_without_company_numbers_to_home', async () => {
    signedIn();
    server({
      modules: readOnly(ModuleKeys.FarmsPhones, ModuleKeys.VisitsMine),
      controlRoom: { isFounder: false, startingRole: 'field_operator', ticks: ['my_visits', 'farmer_phones'], doorSessionRequired: false },
    });
    go('/');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Home' }, { timeout: WAIT })).toBeInTheDocument();
    expect(at()).toBe('/home');
    // No company page was asked for: the person never sees a bounce to the no-access page.
    expect(stub!.requests.some((r) => r.url.includes('/mis/'))).toBe(false);
  });

  it('Root_sends_the_founder_to_company_mis_overview', async () => {
    signedIn();
    server({
      modules: readOnly(ModuleKeys.MetricsNsm, ModuleKeys.FarmsList),
      isPlatformAdmin: true,
      controlRoom: { isFounder: true, startingRole: null, ticks: [], doorSessionRequired: false },
    });
    go('/');
    render(<App />);

    await waitFor(() => expect(at()).toBe('/MIS/overview'), { timeout: WAIT });
  });

  it('Root_sends_a_viewer_with_company_numbers_to_company_mis_overview', async () => {
    signedIn();
    server({
      modules: readOnly(ModuleKeys.MetricsNsm, ModuleKeys.OpsLive),
      controlRoom: { isFounder: false, startingRole: 'viewer', ticks: ['company_numbers', 'server_health'], doorSessionRequired: false },
    });
    go('/');
    render(<App />);

    await waitFor(() => expect(at()).toBe('/MIS/overview'), { timeout: WAIT });
  });
});

describe('a person the server no longer knows (K24)', () => {
  it('A_removed_person_sees_no_company_page: a scope answer of Unauthorized lands on /403', async () => {
    signedIn();
    server({ outcome: 'Unauthorized' });
    go('/MIS/overview');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to the control room.' }, { timeout: WAIT }),
    ).toBeInTheDocument();
    expect(at()).toBe('/403');
    // No company number was asked for, so none is on screen.
    expect(stub!.requests.every((r) => r.url.includes('/admin/me/scope'))).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
  });
});

describe('the door session (H10)', () => {
  it('A_session_not_begun_at_the_door_is_sent_back_to_sign_in', async () => {
    signedIn();
    server({
      modules: [],
      controlRoom: { isFounder: false, startingRole: 'viewer', ticks: ['company_numbers'], doorSessionRequired: true },
    });
    go('/MIS/overview');
    render(<App />);

    // The session is ended the way a sign-out is ended, with the door reason...
    await waitFor(() => expect(endSession).toHaveBeenCalledWith('door-required'), { timeout: WAIT });
    expect(endSession).toHaveBeenCalledTimes(1);
    // ... and the login page then opens with the notice for exactly that reason.
    expect(signedOutNotice('?signedOut=door-required')).toBe('Sign in again here, with a code sent to your phone.');
    // No company request was sent, and no company or home page is on screen.
    expect(stub!.requests.every((r) => r.url.includes('/admin/me/scope'))).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home' })).not.toBeInTheDocument();
  });
});
