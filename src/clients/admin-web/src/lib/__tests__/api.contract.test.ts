import { afterEach, describe, expect, it } from 'vitest';
import { adminApi, AdminModuleForbiddenError, AdminScopeAmbiguousError } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * CHARACTERISATION TEST — Preservation Register A1, A11, A12.
 *
 * Everything asserted here describes the console as it behaves TODAY. If one of
 * these goes red during the v3 port it is a regression, not a disagreement about
 * intent. If a later task changes one of these behaviours deliberately, the test
 * changes in the same commit as the code.
 *
 * These three rows have no pixels. A screenshot diff cannot see a renamed
 * header, a 403 that stopped carrying its module key, or a 401 that started
 * redirecting from the login page into itself.
 */

const ORG = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let stub: StubbedAdapter | null = null;
let locationDescriptor: PropertyDescriptor | undefined;

function ok(data: unknown = {}) {
  return installAdapter(async () => ({ status: 200, data }));
}

function fails(status: number, data: unknown) {
  return installAdapter(async () => ({ status, data }));
}

/**
 * jsdom's `window.location` is replaceable on the window object, but its own
 * `assign` is non-configurable, so `vi.spyOn(window.location, 'assign')` throws
 * (measured, jsdom 29). Swapping the whole property is the only way to observe
 * the redirect at lib/api.ts:66 without a real navigation.
 */
function stubLocation(pathname: string) {
  const calls: string[] = [];
  locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname,
      href: 'http://localhost' + pathname,
      assign: (to: string) => calls.push(to),
    },
  });
  return calls;
}

afterEach(() => {
  stub?.restore();
  stub = null;
  if (locationDescriptor) {
    Object.defineProperty(window, 'location', locationDescriptor);
    locationDescriptor = undefined;
  }
  localStorage.clear();
});

describe('adminApi request contract (A1)', () => {
  it('stamps the active org under the exact header name X-Active-Org-Id', async () => {
    // The header name is coupled to the backend CORS allowlist and to
    // AdminScopeHelper's read (lib/api.ts:17-20). Renaming it silently breaks
    // every request in the console — the browser drops the header at preflight
    // and the server falls back to "no org", which looks like an empty console
    // rather than like a bug.
    //
    // The org must be set on the REAL jsdom URL before the provider mounts:
    // ActiveOrgProvider reads window.location.href (ActiveOrgProvider.tsx:41),
    // not the router. See the note in renderWithProviders.tsx.
    window.history.replaceState({}, '', '/?org=' + ORG);
    renderWithProviders(null);

    stub = ok();
    await adminApi.get('/shramsafal/admin/me/scope');

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0].headers['X-Active-Org-Id']).toBe(ORG);
  });

  it('omits the org header entirely when no org is selected', async () => {
    // `if (orgId)` at lib/api.ts:20 — absent, not empty-string. A missing header
    // and an empty one are different requests to the server.
    window.history.replaceState({}, '', '/');
    renderWithProviders(null);

    stub = ok();
    await adminApi.get('/shramsafal/admin/me/scope');

    expect(Object.keys(stub.requests[0].headers)).not.toContain('X-Active-Org-Id');
  });

  it('stamps the bearer token from the stored session, and omits it when anonymous', async () => {
    stub = ok();
    await adminApi.get('/anonymous');
    expect(Object.keys(stub.requests[0].headers)).not.toContain('Authorization');

    authStore.set({
      accessToken: 'token-123',
      refreshToken: null,
      userId: 'u1',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    });
    await adminApi.get('/authenticated');
    expect(stub.requests[1].headers['Authorization']).toBe('Bearer token-123');
  });
});

describe('adminApi typed error contract (A12)', () => {
  it('maps 428 admin_active_org_required to AdminScopeAmbiguousError carrying memberships', async () => {
    stub = fails(428, {
      code: 'admin_active_org_required',
      memberships: [{ orgId: 'o1', orgName: 'Org One', orgType: 'FPO', orgRole: 'Owner' }],
    });

    const err = await adminApi.get('/x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AdminScopeAmbiguousError);
    expect((err as AdminScopeAmbiguousError).memberships).toHaveLength(1);
    expect((err as AdminScopeAmbiguousError).memberships[0].orgName).toBe('Org One');
    expect((err as Error).name).toBe('AdminScopeAmbiguousError');
    expect((err as Error).message).toBe('admin_active_org_required');
  });

  it('defaults memberships to an empty array when the 428 body omits them', async () => {
    stub = fails(428, { code: 'admin_active_org_required' });
    const err = await adminApi.get('/x').catch((e: unknown) => e);
    expect((err as AdminScopeAmbiguousError).memberships).toEqual([]);
  });

  it('leaves a 428 with any other code as a raw axios error', async () => {
    // The mapping is code-gated, not status-gated (lib/api.ts:71).
    stub = fails(428, { code: 'something_else' });
    const err = await adminApi.get('/x').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AdminScopeAmbiguousError);
  });

  it.each([
    'admin_module_forbidden',
    'admin_platform_only',
    'admin_not_in_org',
    'admin_no_membership',
  ])('maps 403 %s to AdminModuleForbiddenError carrying the module key', async (code) => {
    stub = fails(403, { code, moduleKey: 'ops.live' });

    const err = await adminApi.get('/x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AdminModuleForbiddenError);
    expect((err as AdminModuleForbiddenError).moduleKey).toBe('ops.live');
    expect((err as AdminModuleForbiddenError).code).toBe(code);
    expect((err as Error).message).toBe(code);
  });

  it('carries a null module key — not undefined — when the 403 body omits it', async () => {
    stub = fails(403, { code: 'admin_no_membership' });
    const err = await adminApi.get('/x').catch((e: unknown) => e);
    expect((err as AdminModuleForbiddenError).moduleKey).toBeNull();
  });

  it('leaves a 403 with an unrecognised code as a raw axios error', async () => {
    stub = fails(403, { code: 'forbidden' });
    const err = await adminApi.get('/x').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AdminModuleForbiddenError);
  });

  it('leaves every other status untouched', async () => {
    stub = fails(500, { code: 'admin_module_forbidden' });
    const err = await adminApi.get('/x').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AdminModuleForbiddenError);
    expect(err).not.toBeInstanceOf(AdminScopeAmbiguousError);
  });
});

describe('adminApi 401 contract (A11)', () => {
  it('clears the stored session and redirects to /login', async () => {
    authStore.set({
      accessToken: 't', refreshToken: null, userId: 'u1',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    });
    const assigns = stubLocation('/farms');
    stub = fails(401, {});

    await adminApi.get('/x').catch(() => undefined);

    expect(localStorage.getItem('admin.session.v1')).toBeNull();
    expect(assigns).toEqual(['/login']);
  });

  it('does NOT redirect when the page is already under /login', async () => {
    // The redirect-loop guard at lib/api.ts:65. Without it a 401 raised BY the
    // login request navigates to /login, which re-issues the request, which
    // 401s again — a reload loop the operator cannot escape.
    const assigns = stubLocation('/login');
    stub = fails(401, {});

    await adminApi.get('/x').catch(() => undefined);

    expect(assigns).toEqual([]);
  });

  it('still clears the session on a 401 raised from the login page', async () => {
    authStore.set({
      accessToken: 't', refreshToken: null, userId: 'u1',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    });
    stubLocation('/login');
    stub = fails(401, {});

    await adminApi.get('/x').catch(() => undefined);

    expect(localStorage.getItem('admin.session.v1')).toBeNull();
  });

  it('rejects with the raw axios error, not a typed one', async () => {
    // 401 returns before the 428/403 mapping (lib/api.ts:63-69), so a 401 body
    // that happens to carry a known code is still a plain axios error.
    stubLocation('/farms');
    stub = fails(401, { code: 'admin_module_forbidden', moduleKey: 'ops.live' });

    const err = await adminApi.get('/x').catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(AdminModuleForbiddenError);
    expect(err).not.toBeInstanceOf(AdminScopeAmbiguousError);
  });
});
