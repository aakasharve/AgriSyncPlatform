import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter, Navigate, Route } from 'react-router-dom';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
// Vite's ?raw import — the two ungated-route COMMENTS are part of A4 and comments
// do not survive compilation, so that half has to be read from the source text.
import appSource from '../App.tsx?raw';
import { ThemeProvider, useTheme } from '@/app/ThemeProvider';
import { ActiveOrgProvider, useActiveOrg } from '@/app/ActiveOrgProvider';
import { AdminAuthProvider, useAdminAuth } from '@/app/AdminAuthProvider';
import { EntitlementGuard } from '@/components/EntitlementGuard';
import { ModuleKeys } from '@/lib/moduleKeys';

/**
 * CHARACTERISATION TEST — Preservation Register A3, A4, A45, and the
 * application-level React Query defaults half of A23.
 *
 * This file reads App.tsx STRUCTURALLY rather than as text. `App` calls no
 * hooks (verified), so calling it returns the element tree without rendering,
 * and the route table can be walked as data. That survives reformatting, import
 * reordering and prettier; it does not survive someone moving the routes into a
 * generated array, which is exactly the change that should have to be looked at.
 *
 * The three ungated routes are the sharp edge. `/`, `/schedules/templates` and
 * `/settings/admins` are ungated ON PURPOSE. Adding a guard to any of them is
 * not a consistency cleanup — it locks every user out of the console's home page
 * or its settings, because no ModuleKey exists that would let anyone back in.
 */

/** The map as it stands today. Null means deliberately ungated. */
const ROUTE_GUARDS: Record<string, string | null> = {
  '/': null,                          // deliberate — KPI cards 403 independently
  '/ops/live': ModuleKeys.OpsLive,
  '/ops/errors': ModuleKeys.OpsErrors,
  '/ops/voice': ModuleKeys.OpsVoice,
  '/metrics/nsm': ModuleKeys.MetricsNsm,
  '/farms': ModuleKeys.FarmsList,
  '/farms/silent-churn': ModuleKeys.FarmsSilentChurn,
  '/farms/suffering': ModuleKeys.FarmsSuffering,
  '/farmer-health': ModuleKeys.FarmerHealth,
  '/farmer-health/:farmId': ModuleKeys.FarmerHealth,
  '/users': ModuleKeys.AdminUsers,
  '/schedules/templates': null,       // deliberate — no ModuleKey exists yet
  '/settings/admins': null,           // deliberate — no ModuleKey exists yet
};

/** Routes that sit OUTSIDE the auth + scope shell, by design. */
const PUBLIC_ROUTES = ['/login', '/403'];

const CATCH_ALL = '*';

interface ElementProps {
  children?: ReactNode;
  element?: ReactNode;
  path?: string;
  module?: string;
  to?: string;
  replace?: boolean;
  client?: QueryClient;
}

function propsOf(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

/** Every element in the tree, descending through both `children` and `element`. */
function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement;
  out.push(element);
  const props = propsOf(element);
  if (props.children !== undefined) flatten(props.children, out);
  if (props.element !== undefined) flatten(props.element, out);
  return out;
}

const tree = App() as ReactElement;
const allElements = flatten(tree);
const routeElements = allElements.filter((e) => e.type === Route);

/** The module key of the EntitlementGuard inside a route's own `element` prop. */
function guardOf(route: ReactElement): string | null {
  const guard = flatten(propsOf(route).element).find((e) => e.type === EntitlementGuard);
  return guard ? (propsOf(guard).module ?? null) : null;
}

const declaredRoutes = routeElements
  .filter((r) => typeof propsOf(r).path === 'string')
  .map((r) => ({ path: propsOf(r).path as string, guard: guardOf(r) }));

afterEach(() => {
  localStorage.clear();
});

describe('route to module-key map (A3)', () => {
  it('declares exactly the sixteen routes the console has today', () => {
    const paths = declaredRoutes.map((r) => r.path);
    expect(paths.slice().sort()).toEqual(
      [...Object.keys(ROUTE_GUARDS), ...PUBLIC_ROUTES, CATCH_ALL].sort(),
    );
    expect(paths).toHaveLength(16);
  });

  it('gives every guarded route its exact module key', () => {
    const actual = Object.fromEntries(
      declaredRoutes
        .filter((r) => r.path in ROUTE_GUARDS)
        .map((r) => [r.path, r.guard]),
    );
    expect(actual).toEqual(ROUTE_GUARDS);
  });

  it('guards ten routes and no more', () => {
    expect(declaredRoutes.filter((r) => r.guard !== null)).toHaveLength(10);
  });

  it('uses only module keys that exist in the ModuleKeys registry', () => {
    const known = new Set<string>(Object.values(ModuleKeys));
    for (const route of declaredRoutes) {
      if (route.guard !== null) expect(known.has(route.guard)).toBe(true);
    }
  });

  it('keeps the ModuleKeys registry at its current size', () => {
    // Mirrors ShramSafal.Domain.Organizations.ModuleKey (moduleKeys.ts:9). A key
    // silently dropped here becomes a route that can never be entered.
    expect(Object.keys(ModuleKeys)).toHaveLength(36);
    expect(new Set(Object.values(ModuleKeys)).size).toBe(36);
  });

  it('gates the drilldown on the same key as the farmer-health landing page', () => {
    const landing = declaredRoutes.find((r) => r.path === '/farmer-health');
    const drilldown = declaredRoutes.find((r) => r.path === '/farmer-health/:farmId');
    expect(drilldown?.guard).toBe(landing?.guard);
    expect(drilldown?.guard).toBe(ModuleKeys.FarmerHealth);
  });
});

describe('the three deliberately ungated routes (A4)', () => {
  it.each(['/', '/schedules/templates', '/settings/admins'])(
    '%s carries no EntitlementGuard, and that is the intended behaviour',
    (path) => {
      const route = declaredRoutes.find((r) => r.path === path);
      expect(route).toBeDefined();
      expect(route?.guard).toBeNull();
    },
  );

  it('keeps the comment explaining why Home is ungated', () => {
    // A4 preserves the REASONS, not only the absence. Comments do not survive
    // compilation, so this half is read from the source file.
    expect(appSource).toContain('individual cards can 403 independently');
    expect(appSource).toContain('No single module gate fits, so no guard here');
  });

  it('keeps the comment explaining why Schedules and Settings are ungated', () => {
    expect(appSource).toContain('no matching module key');
    expect(appSource).toContain('Relying on RequireScope');
  });

  it('leaves /login and /403 outside the auth + scope shell', () => {
    // /403 must stay outside RequireScope or an unresolved scope would redirect
    // to a page that itself redirects (ForbiddenPage is where a denial lands).
    const shellRoute = routeElements.find((r) => propsOf(r).path === undefined);
    const insideShell = flatten(propsOf(shellRoute as ReactElement).children)
      .filter((e) => e.type === Route)
      .map((e) => propsOf(e).path);

    for (const path of PUBLIC_ROUTES) expect(insideShell).not.toContain(path);
    for (const path of Object.keys(ROUTE_GUARDS)) expect(insideShell).toContain(path);
  });

  it('sends every unmatched path Home with replace, and no 404 page exists', () => {
    const catchAll = routeElements.find((r) => propsOf(r).path === CATCH_ALL);
    const redirect = flatten(propsOf(catchAll as ReactElement).element).find(
      (e) => e.type === Navigate,
    );
    expect(propsOf(redirect as ReactElement).to).toBe('/');
    expect(propsOf(redirect as ReactElement).replace).toBe(true);
  });
});

describe('provider nesting order is load-bearing (A45)', () => {
  it('nests Theme, QueryClient, Router, ActiveOrg, AdminAuth in that order', () => {
    // Each provider is the single child of the one above it, so the chain can be
    // walked. AdminAuthProvider calls useQueryClient() and must sit inside
    // QueryClientProvider; ActiveOrgProvider must wrap AdminAuthProvider because
    // login() invalidates a scope key whose last segment is the active org.
    const chain: unknown[] = [];
    let current: ReactElement | null = tree;
    while (current && chain.length < 5) {
      chain.push(current.type);
      const children: ReactNode = propsOf(current).children;
      current = isValidElement(children) ? (children as ReactElement) : null;
    }

    expect(chain).toEqual([
      ThemeProvider,
      QueryClientProvider,
      BrowserRouter,
      ActiveOrgProvider,
      AdminAuthProvider,
    ]);
  });

  it.each([
    ['useTheme', useTheme, 'useTheme must be used within ThemeProvider'],
    ['useActiveOrg', useActiveOrg, 'useActiveOrg must be used inside ActiveOrgProvider'],
    ['useAdminAuth', useAdminAuth, 'useAdminAuth must be used within AdminAuthProvider'],
  ])('%s throws by name when used outside its provider', (_name, hook, message) => {
    // Fail fast beats undefined-at-runtime: a consumer mounted in the wrong
    // place breaks the build-time smoke test instead of quietly reading
    // `undefined` and rendering an empty console.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Consumer = () => {
      hook();
      return null;
    };
    expect(() => render(createElement(Consumer))).toThrow(message);
    consoleError.mockRestore();
  });
});

describe('application React Query defaults (A23)', () => {
  it('sets staleTime 60000, refetchOnWindowFocus false and retry 1', () => {
    // Read off the real QueryClient instance App.tsx hands to the provider
    // (App.tsx:34-42), not off the source text.
    const provider = allElements.find((e) => e.type === QueryClientProvider);
    const defaults = propsOf(provider as ReactElement).client?.getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(60_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.retry).toBe(1);
  });
});
