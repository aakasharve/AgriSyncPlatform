import { describe, expect, it } from 'vitest';
import { AdminModuleForbiddenError, AdminScopeAmbiguousError } from '@/lib/api';
import {
  AdminModuleForbiddenError as MovedForbidden,
  AdminScopeAmbiguousError as MovedAmbiguous,
  describeAdminDenial,
} from '@/lib/adminErrors';
import { formatError } from '@/components/state/honestState';

/**
 * Task 11, Step 8 — the typed errors had ZERO catch sites.
 *
 * `AdminScopeAmbiguousError` and `AdminModuleForbiddenError` were constructed
 * by the axios interceptor and caught by nobody, so a port could observe that
 * nothing used them and delete them — permanently discarding the backend's
 * deliberate distinction between `admin_module_forbidden` (ask for a grant),
 * `admin_platform_only` (nobody can grant it to you), `admin_not_in_org`
 * (switch organisation) and `admin_no_membership` (you are not an admin here).
 * Four different things to do about it, one flat 403 on screen.
 *
 * The catch site is `formatError`, which every LoadFailed and ErrorState panel
 * in the console renders through — so naming a denial reaches every screen at
 * once rather than one screen at a time.
 */

describe('the classes moved, and there is still exactly one of each', () => {
  it('re-exports the same class objects from @/lib/api, so instanceof still holds', () => {
    // The definitions moved to lib/adminErrors.ts so the honest-state
    // vocabulary can name a denial without importing axios. Two copies of a
    // class is how `instanceof` starts returning false for the right error.
    expect(AdminModuleForbiddenError).toBe(MovedForbidden);
    expect(AdminScopeAmbiguousError).toBe(MovedAmbiguous);
  });
});

describe('describeAdminDenial (Step 8)', () => {
  it('reads the memberships off a 428 — the server attached the options', () => {
    const denial = describeAdminDenial(
      new AdminScopeAmbiguousError([
        { orgId: 'o1', orgName: 'Org One', orgType: 'FPO', orgRole: 'Owner' },
      ]),
    );

    expect(denial?.code).toBe('admin_active_org_required');
    expect(denial?.memberships).toHaveLength(1);
    expect(denial?.message).toContain('which organisation');
  });

  it('keeps the module key OUT of the sentence and in a copyable detail line', () => {
    // CHANGED 2026-08-31 with the code it describes. This previously asserted
    // the key appeared IN the sentence — which contradicted this module's own
    // stated rule, "never show an operator a machine code". `ops.live` has no
    // human label anywhere; moduleKeys.ts mirrors the C# enum and carries none.
    //
    // The key is not deleted, because it is precisely what a support person
    // relays to get the grant made. It moves to `detail`, following the pattern
    // already chosen for the support loop: the person's words next to the
    // technical truth, the technical truth separately copyable — never the two
    // collapsed into one sentence.
    const denial = describeAdminDenial(
      new AdminModuleForbiddenError('admin_module_forbidden', 'ops.live'),
    );
    expect(denial?.moduleKey).toBe('ops.live');
    expect(denial?.message).not.toContain('ops.live');
    expect(denial?.message).toBe('Your admin access does not include this screen.');
    expect(denial?.detail).toBe('Permission needed: ops.live');
  });

  it('omits the detail line entirely when the server named no module', () => {
    const denial = describeAdminDenial(
      new AdminModuleForbiddenError('admin_module_forbidden', null),
    );
    expect(denial?.detail).toBeUndefined();
  });

  it('still says something useful when the 403 carried no module key', () => {
    const denial = describeAdminDenial(new AdminModuleForbiddenError('admin_module_forbidden', null));
    expect(denial?.message).toBe('Your admin access does not include this screen.');
  });

  it.each([
    ['admin_platform_only', 'Platform owners only'],
    ['admin_not_in_org', 'not a member of the organisation'],
    ['admin_no_membership', 'does not have an admin membership'],
  ])('gives %s its own distinct sentence', (code, fragment) => {
    // If these three ever collapse into one message, the distinction the
    // backend spends four codes maintaining has been thrown away on the client.
    const denial = describeAdminDenial(new AdminModuleForbiddenError(code, null));
    expect(denial?.code).toBe(code);
    expect(denial?.message).toContain(fragment);
  });

  it('gives all five codes a different sentence from every other', () => {
    const codes = [
      'admin_module_forbidden',
      'admin_platform_only',
      'admin_not_in_org',
      'admin_no_membership',
    ];
    const messages = codes.map(
      (c) => describeAdminDenial(new AdminModuleForbiddenError(c, null))?.message,
    );
    messages.push(describeAdminDenial(new AdminScopeAmbiguousError([]))?.message);

    expect(new Set(messages).size).toBe(5);
  });

  it.each([
    [new Error('Request failed with status code 500')],
    [{ message: 'Network Error' }],
    ['boom'],
    [null],
    [new AdminModuleForbiddenError('something_the_server_invented', null)],
  ])('returns null for %o — a broken request is not a denial', (input) => {
    // Telling an operator their access is missing while the server is simply
    // down is the same lie pointing the other way: they go asking for a grant
    // they already have.
    expect(describeAdminDenial(input)).toBeNull();
  });
});

describe('formatError is the catch site (Step 8)', () => {
  it('stops printing the raw machine code at a non-technical operator', () => {
    const raw = new AdminModuleForbiddenError('admin_platform_only', null);
    // What every panel used to show, because Error.message IS the code:
    expect(raw.message).toBe('admin_platform_only');
    // What every panel shows now:
    expect(formatError(raw)).toBe('This screen is for Platform owners only.');
  });

  it('leaves the rest of the unwrapping ladder exactly as it was', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
    expect(formatError('plain string')).toBe('plain string');
    expect(formatError(null)).toBe('Unknown error.');
    expect(formatError({ nope: true })).toBe('Unexpected error — see console.');
  });
});
