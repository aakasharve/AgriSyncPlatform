import type { ReactElement } from 'react';
import { createElement, isValidElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { Route } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { NAV } from '@/app/nav';
import { authStore } from '@/lib/auth';
import { ModuleKeys } from '@/lib/moduleKeys';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * B24 (founder, 2026-11-17) — landing and removed paths.
 * `/ops/voice` is neither a route nor a menu entry (V1 to V5 are doubles of Company MIS Quality);
 * `/` lands on `/MIS/overview` (D-151 a default); Home lives at `/home` and is in the menu as "Home".
 */

interface P { children?: ReactNode; element?: ReactNode; path?: string; to?: string }
function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) { node.forEach((c) => flatten(c, out)); return out; }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement;
  out.push(el);
  const p = el.props as P;
  if (p.children !== undefined) flatten(p.children, out);
  if (p.element !== undefined) flatten(p.element, out);
  return out;
}
const routes = flatten(App() as ReactElement).filter((e) => e.type === Route).map((e) => e.props as P);
const paths = routes.map((r) => r.path);

const SESSION = {
  accessToken: 'token-b24',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000b2',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
};
const WAIT = 15_000;

let stub: StubbedAdapter | null = null;
function appQueryClient(): QueryClient {
  return ((App() as ReactElement).props as { client: QueryClient }).client;
}
function server() {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/admin/me/scope')) {
      return {
        status: 200,
        data: {
          outcome: 'Resolved',
          scope: {
            userId: SESSION.userId, orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', orgType: 'Platform', orgRole: 'Owner', isPlatformAdmin: true,
            modules: Object.values(ModuleKeys).map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
          },
          memberships: [],
        },
      };
    }
    return { status: 200, data: { data: null, meta: { source: 'live', window: '', lastRefreshedUtc: null, ttlSeconds: 0 } } };
  });
}

afterEach(() => {
  stub?.restore();
  stub = null;
  authStore.clear();
  localStorage.clear();
  appQueryClient().clear();
});

describe('the route table and the menu after B24', () => {
  it('B24_ops_voice_is_not_a_route_and_not_a_menu_entry', () => {
    expect(paths).not.toContain('/ops/voice');
    expect(NAV.map((n) => n.to)).not.toContain('/ops/voice');
    expect(NAV.map((n) => n.label)).not.toContain('Voice Pipeline');
  });

  it('B24_slash_redirects_to_MIS_overview_and_home_is_its_own_route', () => {
    const root = routes.find((r) => r.path === '/')!;
    const redirect = flatten(root.element).find((e) => (e.props as P).to !== undefined);
    expect((redirect!.props as P).to).toBe('/MIS/overview');
    expect(paths).toContain('/home');
  });

  it('B24_menu_has_Home_at_slash_home_and_every_idea_page_stays', () => {
    expect(NAV.find((n) => n.to === '/home')?.label).toBe('Home');
    expect(NAV.map((n) => n.to)).not.toContain('/');
    for (const to of ['/ops/live', '/ops/errors', '/metrics/nsm', '/farms', '/farms/silent-churn', '/farms/suffering', '/farmer-health']) {
      expect(NAV.map((n) => n.to), to).toContain(to);
      expect(paths, to).toContain(to);
    }
  });

  it('B24_the_seven_company_MIS_pages_stay_in_the_menu', () => {
    const mis = NAV.filter((n) => n.group === 'Company MIS').map((n) => n.to);
    expect(mis).toEqual(['overview', 'acquisition', 'engagement', 'retention', 'quality', 'farms', 'operations'].map((s) => `/MIS/${s}`));
  });
});

describe('what a person sees at the two addresses (B24)', () => {
  it('B24_ops_voice_shows_the_console_own_not_found_page', async () => {
    authStore.set(SESSION);
    server();
    window.history.replaceState({}, '', '/ops/voice');
    render(createElement(App));
    expect(await screen.findByRole('heading', { name: '404 · No page at this address' }, { timeout: WAIT })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/ops/voice');
  });

  it('B24_slash_lands_on_MIS_overview', async () => {
    authStore.set(SESSION);
    server();
    window.history.replaceState({}, '', '/');
    render(createElement(App));
    await screen.findByRole('heading', { level: 1, name: /overview/i }, { timeout: WAIT });
    expect(window.location.pathname).toBe('/MIS/overview');
  });
});
