/**
 * THE FOUR WAYS THE SERVER SAYS NO — and what each one means to a person.
 *
 * `AdminScopeHelper` (ShramSafal.Api/Endpoints/AdminScopeHelper.cs) does not
 * return one flat 403. It returns five distinct codes, and the distinction is
 * deliberate: `admin_not_in_org` is fixable by switching organisation,
 * `admin_module_forbidden` is fixable by asking for a grant, and
 * `admin_platform_only` is not fixable by the caller at all. The two typed
 * errors below carried that distinction into the client and then **nothing
 * caught them** — zero call sites, verified — so every one of the five reached
 * a screen as its own machine name, or as nothing at all.
 *
 * This module is where the distinction is spent. `describeAdminDenial` is
 * called by `formatError` (components/state/honestState.ts), which is what
 * every `LoadFailed` and `ErrorState` panel in the console renders through,
 * and by ForbiddenPage.
 *
 * ── Why the classes live here and not in lib/api.ts ───────────────────────
 * `lib/api.ts` builds the axios instance and installs its interceptors on
 * import. The honest-state vocabulary is a pure words module that a chunk as
 * small as KpiCard pulls in (see the import-depth note in
 * components/state/index.ts); it must be able to name a denial without
 * dragging the transport in behind it. `lib/api.ts` re-exports both classes,
 * so `import { AdminModuleForbiddenError } from '@/lib/api'` still resolves to
 * these exact classes and `instanceof` still holds.
 */

export interface AdminMembershipSummary {
  orgId: string;
  orgName: string;
  orgType: string;
  orgRole: string;
}

/**
 * 428 `admin_active_org_required` — the caller has more than one admin
 * membership and sent no `X-Active-Org-Id`. The server hands back the list it
 * wants a choice from (AdminScopeHelper.cs:66-80), so this error is not a
 * failure report; it is a question with the options attached.
 */
export class AdminScopeAmbiguousError extends Error {
  readonly memberships: AdminMembershipSummary[];
  constructor(memberships: AdminMembershipSummary[]) {
    super('admin_active_org_required');
    this.name = 'AdminScopeAmbiguousError';
    this.memberships = memberships;
  }
}

/**
 * 403 over four codes. `moduleKey` is present only for
 * `admin_module_forbidden` (AdminScopeHelper.cs:118,132); the other three are
 * denials of the whole scope, not of one module, and carry null.
 */
export class AdminModuleForbiddenError extends Error {
  readonly moduleKey: string | null;
  readonly code: string;
  constructor(code: string, moduleKey: string | null) {
    super(code);
    this.name = 'AdminModuleForbiddenError';
    this.code = code;
    this.moduleKey = moduleKey;
  }
}

export type AdminDenialCode =
  | 'admin_active_org_required'
  | 'admin_module_forbidden'
  | 'admin_platform_only'
  | 'admin_not_in_org'
  | 'admin_no_membership';

export interface AdminDenial {
  code: AdminDenialCode;
  /** Present for `admin_module_forbidden` only. */
  moduleKey: string | null;
  /** Present for `admin_active_org_required` only — the choices the server offered. */
  memberships: AdminMembershipSummary[];
  /** What happened, in the operator's words. Never a code. */
  message: string;
  /** What this person can actually do next. Never "contact support". */
  remedy: string;
  /**
   * The machine fact, kept OUT of `message` and `remedy` so no operator is
   * ever shown a code in a sentence — but kept, because it is exactly what a
   * support person relays to get the grant made. Render it as a separate,
   * copyable line, never inline in the prose.
   */
  detail?: string;
}

const DENIAL_CODES = new Set<string>([
  'admin_active_org_required',
  'admin_module_forbidden',
  'admin_platform_only',
  'admin_not_in_org',
  'admin_no_membership',
]);

function isAdminDenialCode(code: unknown): code is AdminDenialCode {
  return typeof code === 'string' && DENIAL_CODES.has(code);
}

/** The sentence pair for one code. */
function adminDenialCopy(
  code: AdminDenialCode,
  moduleKey?: string | null,
): { message: string; remedy: string; detail?: string } {
  switch (code) {
    case 'admin_active_org_required':
      return {
        message: 'This console needs to know which organisation you are working in.',
        remedy: 'Choose an organisation to continue.',
      };
    case 'admin_module_forbidden':
      // The module key is a MACHINE key (`ops.live`, `farms.list`) with no
      // human label anywhere — moduleKeys.ts is a mirror of the C# enum and
      // carries none. Printing it in the sentence violates the rule this file
      // exists to enforce: never show an operator a machine code.
      //
      // But the key is exactly what a support person must relay to get the
      // grant made, so deleting it costs a real thing. It follows the pattern
      // the founder already chose for the support loop: his words next to the
      // technical truth, the technical truth separately copyable — never the
      // two collapsed into one sentence.
      return {
        message: 'Your admin access does not include this screen.',
        remedy: 'An owner in your organisation can grant it.',
        detail: moduleKey ? `Permission needed: ${moduleKey}` : undefined,
      };
    case 'admin_platform_only':
      return {
        message: 'This screen is for Platform owners only.',
        remedy: 'Ask a Platform owner to open it for you.',
      };
    case 'admin_not_in_org':
      return {
        message: 'You are not a member of the organisation this page is scoped to.',
        remedy: 'Switch to an organisation you belong to.',
      };
    case 'admin_no_membership':
      // Deliberately the same words /403 already showed for this case
      // (ForbiddenPage's no-membership variant). Two surfaces describing one
      // server state differently is how a person concludes they are two
      // different problems.
      return {
        message: 'Your account does not have an admin membership for this console.',
        remedy: 'Ask a Platform owner to invite you via /settings/admins.',
      };
  }
}

/**
 * Recognise a denial, or return null so the caller keeps its own handling.
 *
 * Null is the important half: a 500, a timeout and a dropped connection are
 * NOT denials, and turning one into "you do not have access" is the same lie
 * in the opposite direction — it tells an operator to go asking for a grant
 * they already have while the server is down.
 */
export function describeAdminDenial(error: unknown): AdminDenial | null {
  if (error instanceof AdminScopeAmbiguousError) {
    return {
      code: 'admin_active_org_required',
      moduleKey: null,
      memberships: error.memberships,
      ...adminDenialCopy('admin_active_org_required'),
    };
  }

  if (error instanceof AdminModuleForbiddenError && isAdminDenialCode(error.code)) {
    return {
      code: error.code,
      moduleKey: error.moduleKey,
      memberships: [],
      ...adminDenialCopy(error.code, error.moduleKey),
    };
  }

  return null;
}
