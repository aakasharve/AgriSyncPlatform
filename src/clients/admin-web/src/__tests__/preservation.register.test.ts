import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ModuleKeys } from '@/lib/moduleKeys';

/**
 * THE FOUNDER'S GUARANTEE, AS AN EXECUTABLE — Task 30.
 *
 * The Preservation Register is a promise that fifty-nine capabilities which
 * exist in the console today survive a design-led rewrite. A promise nothing
 * checks is a hope, and a register ticked by hand at the end of a thirty-task
 * migration is a hope with a table around it.
 *
 * ── WHAT THIS FILE IS, AND WHAT IT IS NOT ────────────────────────────────
 * It is a ROLL-CALL, not a second copy of the suite. Forty-eight other files
 * already prove the BEHAVIOUR — that a 401 redirects, that a sort is live,
 * that a chip cannot invent an age. This file answers a different question,
 * the one the founder actually asked: *is every line of the register
 * accounted for, and can I see the ones that are not?*
 *
 * So every row lands in exactly one of four verdicts, and the shape of the
 * table makes a fifth impossible:
 *
 *   kept      the capability shipped as registered. Asserted here against the
 *             artefact that carries it, and `provenBy` names the file whose
 *             behavioural test would go red if the behaviour changed.
 *   changed   the capability shipped, but NOT as the register describes it.
 *             The row records what actually shipped and who decided. This is
 *             the verdict the register had no column for, and eleven rows
 *             need it — every one of them found by a task doing the work,
 *             not by reading the plan.
 *   manual    it cannot be asserted from a static sweep. The Founder
 *             Acceptance Gate step that covers it is named, so the gap is
 *             VISIBLE rather than assumed.
 *   unsigned  it was DROPPED, and needs the founder's signature in the
 *             Deliberately-Dropped table. Nothing here forges one.
 *
 * ── THE TRAP THIS FILE IS SHAPED LIKE ────────────────────────────────────
 * Task 28 found a sequencing guard that could not fail: `\b(glass|glass-panel)\b`
 * matches INSIDE `glass-panel`, because a hyphen is a non-word character, so
 * an "is it gone?" assertion passed while the class was still there. A
 * register test is exactly that shape — a long list of green ticks nobody
 * reads. Every assertion below was therefore MUTATED and watched go red
 * naming its own row; the roll-call test prints the row id in its failure
 * message for that reason.
 *
 * ── CONTRACT.md ──────────────────────────────────────────────────────────
 * Every `§N` citation in this repo — in the code, in the plan and below —
 * points at `G:/VALIDATION/ADMIN_ REDESIGN/v3/CONTRACT.md`. THAT FILE IS NOT
 * IN THIS REPOSITORY. A reviewer with only the repo cannot check a single one
 * of them, which is worth knowing before treating a §-citation as a source.
 */

/* ═══════════════════════════════════════════════════ the source under test ══ */

const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ),
);

/** The declarations only. A row must not be able to pass on a comment that
 *  mentions the capability — that is the whole failure mode of a register. */
const code = (path: string): string => {
  const source = SOURCES[path];
  if (source === undefined) throw new Error(`register: no such file ${path}`);
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};

/** The raw text, for the handful of rows where a COMMENT is the artefact —
 *  A4 registers two code comments, and a comment cannot be read any other
 *  way. */
const raw = (path: string): string => {
  const source = SOURCES[path];
  if (source === undefined) throw new Error(`register: no such file ${path}`);
  return source;
};

const fileExists = (path: string) => existsSync(resolve(process.cwd(), path.replace(/^\//, '')));

/**
 * The stylesheet, read from DISK.
 *
 * `import.meta.glob` above matches `.ts` and `.tsx`; `vitest.config.ts` sets
 * `css: false`, which stubs every css request — `?raw` included — to an empty
 * string. Either route hands this file '' and every assertion about the token
 * layer then passes against nothing, which is the toothless shape this whole
 * file is written against. Same reason, and same fix, as
 * `styles/__tests__/tokens.contract.test.ts`.
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf-8');
const cssRules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

it('read the real stylesheet, not an empty stub', () => {
  expect(CSS.length).toBeGreaterThan(2000);
  expect(CSS).toContain('@theme');
});

/* ══════════════════════════════════════════════════════════ the verdicts ══ */

type Verdict =
  | { kind: 'kept'; assert: () => void; provenBy?: string[] }
  | { kind: 'changed'; shipped: string; decidedBy: string; assert: () => void }
  | { kind: 'manual'; gate: string }
  | { kind: 'unsigned'; dropped: string; needs: string };

interface Row {
  what: string;
  verdict: Verdict;
}

const kept = (assert: () => void, ...provenBy: string[]): Verdict => ({
  kind: 'kept',
  assert,
  provenBy,
});

/* ════════════════════════════════════════════════════════════ the register ══ */

const REGISTER: Record<string, Row> = {
  A1: {
    what: 'X-Active-Org-Id stamped on every admin request',
    verdict: kept(() => {
      expect(code('/src/lib/api.ts')).toContain(
        "config.headers.set('X-Active-Org-Id', orgId)",
      );
      expect(code('/src/lib/api.ts')).toContain('getActiveOrgIdSnapshot()');
    }, '/src/__tests__/tenancy.contract.test.tsx'),
  },

  A2: {
    what: 'four-outcome scope resolver plus the two full-page OrgSwitcher interstitials',
    verdict: kept(() => {
      const app = code('/src/App.tsx');
      for (const outcome of ['Unauthorized', 'Ambiguous', 'NotInOrg', 'Resolved']) {
        expect(app).toContain(outcome);
      }
      // The two headlines are DIFFERENT sentences on purpose: "not yours" and
      // "pick one" are different facts, and A2 registers both.
      expect(app).toContain('That organization is not in your memberships');
      expect(app).toContain('Choose your active organization');
    }, '/src/__tests__/tenancyRouting.contract.test.tsx'),
  },

  A3: {
    what: 'EntitlementGuard on the guarded routes, and the ModuleKeys registry',
    verdict: {
      kind: 'changed',
      shipped:
        'ten of thirteen in-shell routes are guarded and ModuleKeys holds 36 keys — ' +
        'the register prose said nine of twelve and 33',
      decidedBy: 'measurement, 2026-08-31 (the plan corrected its own prose)',
      assert: () => {
        expect(Object.keys(ModuleKeys)).toHaveLength(36);
        const app = code('/src/App.tsx');
        expect([...app.matchAll(/<EntitlementGuard module=/g)]).toHaveLength(10);
      },
    },
  },

  A4: {
    what: 'three routes deliberately ungated, and the comments that say why',
    verdict: kept(() => {
      const app = code('/src/App.tsx');
      // Ungated means the path is declared with no guard element beside it.
      for (const path of ['path="/"', 'path="/schedules/templates"', 'path="/settings/admins"']) {
        expect(app).toContain(path);
      }
      expect(app).not.toMatch(/path="\/schedules\/templates"[^\n]*EntitlementGuard/);
      expect(app).not.toMatch(/path="\/settings\/admins"[^\n]*EntitlementGuard/);
      // The reasons are comments, and comments are the artefact this row names.
      expect(raw('/src/App.tsx')).toContain('no matching module key');
      expect(raw('/src/App.tsx')).toContain('403 independently');
    }, '/src/__tests__/routes.contract.test.ts', '/src/__tests__/deepLink.contract.test.tsx'),
  },

  A5: {
    what: 'in-page ops gate on drilldown Band 5, with the "Ops data hidden" panel',
    verdict: {
      kind: 'changed',
      shipped:
        'gated PER BLOCK on ops.errors (sync) and ops.voice (AI), not on the single ' +
        'ops.live key the register names — the server fills the two blocks independently, ' +
        'so one key was wrong in both directions',
      decidedBy: 'Task 23, on repo-is-truth grounds (AdminFarmerHealthRepository.cs:80-85)',
      assert: () => {
        const drill = code('/src/features/farmer-health/FarmerHealthDrilldown.tsx');
        expect(drill).toContain('OPS_BLOCKS.sync.module');
        expect(drill).toContain('OPS_BLOCKS.ai.module');
        expect(drill).toContain('Ops data hidden');
        // The single-key version would read `canRead(ModuleKeys.OpsLive)`.
        expect(drill).not.toContain('ModuleKeys.OpsLive');
      },
    },
  },

  A6: {
    what: 'canRead / canWrite / canExport fail closed',
    verdict: kept(() => {
      const scope = code('/src/hooks/useAdminScope.ts');
      expect(scope).toContain('if (!scope) return false;');
      for (const p of ['canRead:', 'canWrite:', 'canExport:']) expect(scope).toContain(p);
    }, '/src/hooks/__tests__/useAdminScope.contract.test.tsx'),
  },

  A7: {
    what: 'the scope query key carries the active org',
    verdict: kept(() => {
      expect(code('/src/hooks/useAdminScope.ts')).toContain(
        "queryKey: ['admin', 'me', 'scope', org]",
      );
    }, '/src/__tests__/tenancy.contract.test.tsx'),
  },

  A8: {
    what: 'EntitlementGuard renders null while the scope loads, and never redirects',
    verdict: kept(() => {
      expect(code('/src/components/EntitlementGuard.tsx')).toMatch(/isLoading\)\s*return null;/);
    }, '/src/components/__tests__/EntitlementGuard.contract.test.tsx'),
  },

  A9: {
    what: 'RequireAuth captures the deep link, and LoginPage spends it',
    verdict: kept(() => {
      expect(code('/src/App.tsx')).toContain('state={{ from: currentPathWithQuery(location) }}');
      expect(code('/src/pages/LoginPage.tsx')).toContain('safeReturnTo(');
    }, '/src/lib/__tests__/returnTo.test.ts', '/src/__tests__/deepLink.contract.test.tsx'),
  },

  A10: {
    what: 'session persistence with client-side expiry, and cache hygiene on login/logout',
    verdict: kept(() => {
      const auth = code('/src/lib/auth.ts');
      expect(auth).toContain("const STORAGE_KEY = 'admin.session.v1'");
      expect(auth).toContain('new Date(s.expiresAtUtc).getTime() <= Date.now()');
      const provider = code('/src/app/AdminAuthProvider.tsx');
      expect(provider).toContain('qc.invalidateQueries');
      expect(provider).toContain('qc.removeQueries');
    }, '/src/lib/__tests__/auth.contract.test.ts'),
  },

  A11: {
    what: 'the global 401 interceptor, with its redirect-loop guard',
    verdict: kept(() => {
      const api = code('/src/lib/api.ts');
      expect(api).toContain('if (status === 401)');
      expect(api).toContain('authStore.clear()');
      expect(api).toContain("!window.location.pathname.startsWith('/login')");
    }, '/src/lib/__tests__/api.contract.test.ts'),
  },

  A12: {
    what: 'typed 428 and 403 over four backend codes',
    verdict: kept(() => {
      const api = code('/src/lib/api.ts');
      expect(api).toContain("status === 428 && body?.code === 'admin_active_org_required'");
      expect(api).toContain('new AdminScopeAmbiguousError');
      expect(api).toContain('new AdminModuleForbiddenError');
      for (const c of [
        'admin_module_forbidden',
        'admin_platform_only',
        'admin_not_in_org',
        'admin_no_membership',
      ]) {
        expect(api).toContain(c);
      }
    }, '/src/lib/__tests__/api.contract.test.ts', '/src/lib/__tests__/adminErrors.test.ts'),
  },

  A13: {
    what: 'the /403 page — two message branches, a sign-out, outside RequireScope',
    verdict: {
      kind: 'changed',
      shipped:
        'the page and both branches survive, but it is NO LONGER "the ONLY sign-out ' +
        'control in the app" — B3 put one in the shell, because a signed-in admin on a ' +
        'working screen had no way out',
      decidedBy: 'Task 10, satisfying register row B3',
      assert: () => {
        const page = code('/src/pages/ForbiddenPage.tsx');
        expect(page).toContain('scopeUnavailable');
        expect(page).toContain('Sign out');
        expect(code('/src/App.tsx')).toMatch(/path="\/403"/);
        // The second one, which is what makes this row "changed".
        expect(code('/src/app/AdminShell.tsx')).toContain("aria-label=\"Sign out\"");
      },
    },
  },

  A14: {
    what: 'redaction-aware DTO contract and redaction-tolerant rendering',
    verdict: kept(() => {
      const redaction = code('/src/components/state/redaction.ts');
      expect(redaction).toContain('**redacted**');
      expect(redaction).toContain('isPartlyMasked');
      expect(redaction).toContain('export function isRedacted');
      // `Masked` reads the three-way state rather than re-deriving it, which is
      // what stops "partly masked" and "withheld" collapsing into one branch.
      expect(code('/src/components/state/Masked.tsx')).toContain('maskState(');
    }, '/src/components/state/__tests__/honestStates.test.tsx'),
  },

  A15: {
    what: '?org= with UUID validation and URL → localStorage → null precedence',
    verdict: kept(() => {
      const provider = code('/src/app/ActiveOrgProvider.tsx');
      expect(provider).toMatch(/[0-9a-f]\{8\}-\[0-9a-f\]\{4\}|isUuid|UUID_RE/i);
      expect(provider).toContain('admin.active-org.v1');
    }, '/src/__tests__/tenancyRouting.contract.test.tsx'),
  },

  A16: {
    what: '?since on API Errors',
    verdict: {
      kind: 'changed',
      shipped:
        'the parameter still works exactly as registered, but it is no longer "reachable ' +
        'only by hand-editing the URL" — Task 18 gave it a visible control, which is what ' +
        'gate item 4 asks the founder to see',
      decidedBy: 'Task 18 Steps 1–4',
      assert: () => {
        const page = code('/src/pages/ops/OpsErrorsPage.tsx');
        expect(page).toContain("url.get('since')");
        expect(code('/src/hooks/useOpsErrors.ts')).toContain('since');
      },
    },
  },

  A17: {
    what: 'server-side ?page pagination with items / totalCount / page / pageSize',
    verdict: {
      kind: 'changed',
      shipped:
        'three screens carry it — Farms (40), Users (50), API Errors (50). Task 18 ' +
        'inherited the phrase "the one screen that already has server pagination", which ' +
        'was never true of this row; what was unique to API Errors was the LIBRARY (A50)',
      decidedBy: 'Task 18, measurement',
      assert: () => {
        expect(code('/src/hooks/useFarms.ts')).toContain('pageSize');
        expect(code('/src/hooks/useUsers.ts')).toContain('pageSize');
        expect(code('/src/hooks/useOpsErrors.ts')).toContain('pageSize');
        expect(code('/src/pages/farms/FarmsListPage.tsx')).toContain('PAGE_SIZE = 40');
        expect(code('/src/pages/users/UsersPage.tsx')).toContain('PAGE_SIZE = 50');
        expect(code('/src/pages/ops/OpsErrorsPage.tsx')).toContain('PAGE_SIZE = 50');
      },
    },
  },

  A18: {
    what: 'URL-synced filter state across five pages',
    verdict: kept(() => {
      // One hook owns every read and write, which is what stopped five screens
      // drifting into five spellings of the same parameter.
      const hook = code('/src/lib/useListUrlState.ts');
      expect(hook).toContain('useSearchParams');
      for (const page of [
        '/src/pages/farms/FarmsListPage.tsx',
        '/src/pages/users/UsersPage.tsx',
        '/src/pages/ops/OpsErrorsPage.tsx',
        '/src/pages/ops/OpsVoicePage.tsx',
        '/src/pages/metrics/NorthStarPage.tsx',
      ]) {
        expect(code(page)).toMatch(/useListUrlState|useSearchParams/);
      }
    }, '/src/lib/__tests__/useListUrlState.test.tsx'),
  },

  A19: {
    what: '?weeks 8/12/24 and ?days 7/14/30 flowing into the interpolated title',
    verdict: kept(() => {
      expect(code('/src/pages/metrics/NorthStarPage.tsx')).toContain(
        'title={`WVFD — last ${weeks} weeks`}',
      );
      expect(code('/src/pages/ops/OpsVoicePage.tsx')).toMatch(/\$\{days\}/);
    }, '/src/pages/metrics/__tests__/NorthStarPage.test.tsx', '/src/pages/ops/__tests__/OpsVoicePage.test.tsx'),
  },

  A20: {
    what: 'functional setSearchParams updater, and page reset to 1 on every filter change',
    verdict: kept(() => {
      const hook = code('/src/lib/useListUrlState.ts');
      // The FUNCTIONAL form. Passing a plain object replaces the whole query
      // string, which is how `?org=` — whose data the page shows — gets
      // dropped by a filter change.
      expect(hook).toContain('setSearchParams((prev) => {');
      expect(hook).toContain('PAGE_KEY');
    }, '/src/lib/__tests__/useListUrlState.test.tsx'),
  },

  A21: {
    what: 'the search draft is not URL-synced until Enter; the endpoint input commits on blur too',
    verdict: kept(() => {
      const list = code('/src/components/data/DataList.tsx');
      // Two DIFFERENT commit contracts, named, in one component: the draft that
      // waits for Enter (Farms, Users) and the one that also commits on blur
      // (API Errors). Collapsing them changes WHEN a filter applies.
      expect(list).toContain("search.commit === 'blur-or-enter'");
      expect(list).toContain('url.blurCommitInputProps(');
      expect(list).toContain('url.draftInputProps');
    }, '/src/components/data/__tests__/DataList.test.tsx'),
  },

  A22: {
    what: 'the /farmer-health/:farmId drilldown route and its components',
    verdict: kept(() => {
      expect(code('/src/App.tsx')).toContain('path="/farmer-health/:farmId"');
      for (const component of [
        '/src/features/farmer-health/components/DwcScoreCard.tsx',
        '/src/features/farmer-health/components/FarmerTimeline.tsx',
        '/src/features/farmer-health/components/WorkerSummaryList.tsx',
        '/src/features/farmer-health/components/SyncStateBlock.tsx',
        '/src/features/farmer-health/components/AiHealthBlock.tsx',
        '/src/features/farmer-health/components/FarmerSearchBox.tsx',
      ]) {
        expect(fileExists(component)).toBe(true);
      }
    }, '/src/features/farmer-health/__tests__/FarmerHealthDrilldown.test.tsx'),
  },

  A23: {
    what: 'per-surface polling cadences plus the React Query global defaults',
    verdict: kept(() => {
      const app = code('/src/App.tsx');
      expect(app).toContain('staleTime: 60_000');
      expect(app).toContain('refetchOnWindowFocus: false');
      expect(app).toContain('retry: 1');
      expect(code('/src/hooks/useOpsHealth.ts')).toContain('refetchInterval: 30_000');
      expect(code('/src/hooks/useOpsErrors.ts')).toContain('refetchInterval: 30_000');
    }, '/src/hooks/__tests__/queryContracts.contract.test.tsx'),
  },

  A24: {
    what: 'the AdminResponse envelope driving FreshnessChip',
    verdict: {
      kind: 'changed',
      shipped:
        'the envelope drives the chip on the screens that HAVE one, read through ' +
        'metaRefreshedAt() because the server sends lastRefreshedUtc and this type once ' +
        'declared the opposite. FOUR endpoints send no envelope at all (A27), and Live ' +
        'Health’s chip is driven by the server’s computedAtUtc instead',
      decidedBy: 'Tasks 17, 20, 22 and 24 — four separate measurements',
      assert: () => {
        const api = code('/src/lib/api.ts');
        expect(api).toContain('export function metaRefreshedAt');
        expect(api).toContain('meta?.lastRefreshedUtc ?? meta?.lastRefreshed');
        expect(code('/src/pages/ops/OpsLivePage.tsx')).toContain('computedAtUtc');
      },
    },
  },

  A25: {
    what: 'keepPreviousData on the paginated lists, and the Refreshing indicator',
    verdict: kept(() => {
      for (const hook of ['/src/hooks/useFarms.ts', '/src/hooks/useUsers.ts', '/src/hooks/useOpsErrors.ts']) {
        expect(code(hook)).toContain('keepPreviousData');
      }
      expect(code('/src/components/data/DataList.tsx')).toContain('Refreshing');
    }, '/src/components/data/__tests__/DataList.test.tsx'),
  },

  A26: {
    what: 'farmer-health lives on a different path prefix, and templates returns a raw array',
    verdict: kept(() => {
      const fhApi = code('/src/features/farmer-health/api/farmerHealthApi.ts');
      expect(fhApi).toContain('/admin/farmer-health/');
      expect(fhApi).not.toContain('/shramsafal/admin/farmer-health');
      expect(code('/src/hooks/useScheduleTemplates.ts')).toContain('/shramsafal/reference/schedule-templates');
    }, '/src/hooks/__tests__/queryContracts.contract.test.tsx'),
  },

  A27: {
    what: 'the endpoints that return no AdminResponse envelope',
    verdict: {
      kind: 'changed',
      shipped:
        'FOUR, not one. /ops/health (A27 as written), the two farmer-health endpoints ' +
        '(Task 22) and the schedule-templates raw array (Task 24, already registered as ' +
        'A26 and counted by neither). /ops/health’s computedAtUtc is no longer discarded',
      decidedBy: 'Tasks 22 and 24, measurement',
      assert: () => {
        const hook = code('/src/hooks/useOpsHealth.ts');
        expect(hook).toContain('adminApi.get<OpsHealthData>');
        // The A27 mistake in source form would be `AdminResponse<OpsHealthData>`.
        expect(hook).not.toContain('adminApi.get<AdminResponse<OpsHealthData>>');
        expect(code('/src/pages/ops/OpsLivePage.tsx')).toContain('computedAtUtc');
      },
    },
  },

  A28: {
    what: 'AbortSignal threaded into axios, and useFarmerHealth retry 0 plus enabled-gating',
    verdict: kept(() => {
      expect(code('/src/features/farmer-health/hooks/useCohortPatterns.ts')).toContain('signal');
      const fh = code('/src/features/farmer-health/hooks/useFarmerHealth.ts');
      expect(fh).toContain('retry: 0');
      expect(fh).toContain('enabled');
    }, '/src/hooks/__tests__/queryContracts.contract.test.tsx'),
  },

  A29: {
    what: 'FarmerSearchBox probe-then-navigate',
    verdict: kept(() => {
      const box = code('/src/features/farmer-health/components/FarmerSearchBox.tsx');
      expect(box).toContain('encodeURIComponent');
      expect(box).toContain('onResolved');
      expect(box).toMatch(/300/);
    }, '/src/features/farmer-health/__tests__/FarmerHealthPage.test.tsx'),
  },

  A30: {
    what: 'intervention-queue sorting — four columns, per-column default direction, tiebreak',
    verdict: kept(() => {
      expect(fileExists('/src/components/data/sortRows.ts')).toBe(true);
      expect(code('/src/features/farmer-health/FarmerHealthPage.tsx')).toContain('lastActiveAt');
    }, '/src/components/data/__tests__/sortRows.test.ts', '/src/features/farmer-health/__tests__/FarmerHealthPage.test.tsx'),
  },

  A31: {
    what: 'the watchlist is collapsed by default and its order is FIXED, not user-sortable',
    verdict: kept(() => {
      expect(code('/src/features/farmer-health/FarmerHealthPage.tsx')).toContain('weeklyDelta');
    }, '/src/features/farmer-health/__tests__/FarmerHealthPage.test.tsx'),
  },

  A32: {
    what: 'an accessible data table under every chart, and named per-band loading states',
    verdict: kept(() => {
      // `dataTable` is a REQUIRED prop, so a chart without a table is a compile
      // error rather than a review miss.
      expect(code('/src/components/data/ChartShell.tsx')).toContain('dataTable: ChartDataTable<V>;');
      expect(code('/src/components/state/LoadingState.tsx')).toContain('aria-label={label}');
    }, '/src/__tests__/a11y.sweep.test.tsx', '/src/components/data/__tests__/ChartShell.test.tsx'),
  },

  A33: {
    what: 'zero-fill normalisation to fixed axes, so absent data cannot reshuffle a chart',
    verdict: {
      kind: 'changed',
      shipped:
        'the property is kept and centralised in fillAxis, which is STRONGER than the ' +
        'registered version: an absent slot is a hatched gap, never a zero-height bar. ' +
        'The row’s citation `PillarHeatmap.tsx:25,48` is imprecise — those lines are the ' +
        'PILLAR_ORDER constant, and the `?? 0` fallbacks it means sit at :51 and :53',
      decidedBy: 'Task 9 (one axis module), citation corrected by measurement',
      assert: () => {
        const fill = code('/src/components/data/fillAxis.ts');
        expect(fill).toContain('export function fillAxis');
        expect(fill).toContain('kind: \'gap\'');
      },
    },
  },

  A34: {
    what: 'runtime Devanagari detection switching the font per name',
    verdict: kept(() => {
      const person = code('/src/components/ui/PersonName.tsx');
      expect(person).toContain('hasDevanagari');
      expect(person).toContain("'Noto Sans Devanagari', sans-serif");
      // FOUR duplicated checks collapsed into ONE. A second hand-rolled range
      // test anywhere is the regression this row exists to catch, so the
      // Devanagari code-block may be written in exactly one file.
      const others = Object.entries(SOURCES)
        .filter(([path]) => path !== '/src/lib/searchKey.ts' && !path.includes('__tests__'))
        .filter(([, source]) => /0900|097F/i.test(source))
        .map(([path]) => path);
      expect(others).toEqual([]);
    }, '/src/components/ui/__tests__/PersonName.test.tsx'),
  },

  A35: {
    what: 'the mandatory verbatim compliance copy',
    verdict: kept(() => {
      expect(code('/src/components/state/ScoringActiveBanner.tsx')).toContain(
        'data accumulating',
      );
      expect(code('/src/features/farmer-health/components/WorkerSummaryList.tsx')).toMatch(
        /disclaimer|not a payroll|no payment/i,
      );
    }, '/src/components/state/__tests__/honestStates.test.tsx'),
  },

  A36: {
    what: 'understated-vs-normal empty copy on the intervention queue',
    verdict: kept(() => {
      const empty = code('/src/components/state/InterventionQueueEmpty.tsx');
      expect(empty).toMatch(/understated/i);
    }, '/src/components/state/__tests__/honestStates.test.tsx'),
  },

  A37: {
    what: 'C7 — a healthy pillar tops out at teal; C8 — a slate inset marks a privileged panel',
    verdict: kept(() => {
      expect(code('/src/features/farmer-health/components/OpsPanel.tsx')).toMatch(/slate|inset/i);
    }, '/src/styles/__tests__/tokens.contract.test.ts'),
  },

  A38: {
    what: 'AiHealth rate sanitisation',
    verdict: {
      kind: 'changed',
      shipped:
        'the registered rule ("never a fabricated 0%") is kept via rate01, AND the ' +
        'fabrication the live code actually ships is a 100%: GetAiHealthAsync returns ' +
        '(1m, 1m, 0) from its catch and COALESCEs both ratios to 1.0 on a zero ' +
        'denominator. Both are now guarded, and the 100% case is stated on screen',
      decidedBy: 'Task 23, measurement',
      assert: () => {
        expect(code('/src/lib/format.ts')).toContain('export function rate01');
        const block = code('/src/features/farmer-health/components/AiHealthBlock.tsx');
        expect(block).toContain('rate01(');
        expect(block).toMatch(/100 per cent/);
      },
    },
  },

  A39: {
    what: 'the active org named on screen',
    verdict: kept(() => {
      expect(code('/src/app/AdminShell.tsx')).toContain('Active organization: ');
      expect(code('/src/features/farmer-health/FarmerHealthPage.tsx')).toMatch(/orgName|organisation|organization/i);
    }, '/src/app/__tests__/AdminShell.test.tsx'),
  },

  A40: {
    what: 'drilldown four-branch state handling with Band 1 rendered through every branch',
    verdict: kept(() => {
      expect(code('/src/features/farmer-health/FarmerHealthDrilldown.tsx')).toContain(
        'not found in your scope',
      );
    }, '/src/features/farmer-health/__tests__/FarmerHealthDrilldown.test.tsx'),
  },

  A41: {
    what: 'ErrorState with a working Retry, plus the formatError unwrapping ladder',
    verdict: {
      kind: 'changed',
      shipped:
        'both properties live in LoadFailed, which also makes onRetry MANDATORY rather ' +
        'than optional. ErrorState itself now has ZERO CALL SITES and is kept solely ' +
        'because this row names it — recorded plainly rather than deleted quietly',
      decidedBy: 'Task 23, and Task 27 chose to keep it',
      assert: () => {
        expect(fileExists('/src/components/state/ErrorState.tsx')).toBe(true);
        expect(code('/src/components/state/honestState.ts')).toContain('formatError');
        // The claim itself: zero importers outside the barrel and its own file.
        const importers = Object.entries(SOURCES)
          .filter(([p]) => !p.includes('__tests__'))
          .filter(([p]) => p !== '/src/components/state/ErrorState.tsx')
          .filter(([p]) => p !== '/src/components/state/index.ts')
          .filter(([, s]) => /<ErrorState[\s/>]/.test(s))
          .map(([p]) => p);
        expect(importers).toEqual([]);
      },
    },
  },

  A42: {
    what: 'route-level code splitting — every page behind one Suspense',
    verdict: kept(() => {
      const app = code('/src/App.tsx');
      expect([...app.matchAll(/lazy\(\(\) => import\(/g)].length).toBeGreaterThanOrEqual(13);
      expect(app).toContain('<Suspense fallback={<Fallback />}>');
    }, '/src/__tests__/routes.contract.test.ts'),
  },

  A43: {
    what: 'the catch-all route',
    verdict: {
      kind: 'changed',
      shipped:
        'a REAL 404 page replaces `<Navigate to="/" replace />`. The silent bounce is ' +
        'what masked D11 — an unregistered /farms/:farmId link — for its whole life, so ' +
        'a typo, a stale bookmark and a bug were indistinguishable',
      decidedBy: 'Task 27 Step 2 (explicit decision; the founder may revert it)',
      assert: () => {
        const app = code('/src/App.tsx');
        expect(app).toContain('<Route path="*" element={<NotFoundPage />} />');
        expect(app).not.toContain('path="*" element={<Navigate to="/"');
      },
    },
  },

  A44: {
    what: 'the server-side SPA history fallback the deep links depend on',
    verdict: kept(() => {
      expect(fileExists('../../../aws/admin/cloudfront-spa-fallback.json')).toBe(true);
      expect(fileExists('scripts/deploy-s3.sh')).toBe(true);
    }, '/src/__tests__/buildConfig.contract.test.ts'),
  },

  A45: {
    what: 'the provider nesting order, and the fail-fast throws',
    verdict: kept(() => {
      const app = code('/src/App.tsx');
      const order = ['QueryClientProvider', 'BrowserRouter', 'ActiveOrgProvider', 'AdminAuthProvider'];
      const positions = order.map((p) => app.indexOf(`<${p}`));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      // Both throw BY NAME. The wording differs — "within" and "inside" — and
      // pinning one spelling would fail on a copy-edit rather than on the
      // property, which is that neither hook returns undefined in silence.
      expect(code('/src/app/AdminAuthProvider.tsx')).toMatch(
        /throw new Error\('useAdminAuth must be used (within|inside)/,
      );
      expect(code('/src/app/ActiveOrgProvider.tsx')).toMatch(
        /throw new Error\('useActiveOrg must be used (within|inside)/,
      );
    }, '/src/__tests__/routes.contract.test.ts'),
  },

  A46: {
    what: 'command-palette placement and entitlement filtering',
    verdict: {
      kind: 'changed',
      shipped:
        'BOTH facts were consciously reversed, which is what this row asked for. The ' +
        'palette moved INSIDE RequireAuth and RequireScope — a security change, because ' +
        'Task 13 made it index farm names and farmer phone numbers — and it now filters ' +
        'by entitlement, failing closed while the scope is unresolved',
      decidedBy: 'Task 13',
      assert: () => {
        const app = code('/src/App.tsx');
        const palette = app.indexOf('<CommandPalette />');
        const requireAuth = app.indexOf('<RequireAuth>');
        expect(requireAuth).toBeGreaterThan(-1);
        expect(palette).toBeGreaterThan(requireAuth);
        expect(code('/src/app/CommandPalette.tsx')).toContain('canRead(');
      },
    },
  },

  A47: {
    what: 'the Tailwind v4 @theme token layer and the dark variant bound to data-mode',
    verdict: {
      kind: 'changed',
      shipped:
        'the @theme layer is kept and is now the ONE place a colour is written. The ' +
        'second half — the custom dark variant and the data-mode binding — was DELETED ' +
        'with dark mode itself, and the inert dark: utilities were stripped rather than ' +
        'left dead, exactly as the global constraint required',
      decidedBy: 'D1, FOUNDER 2026-08-31 ("drop , drop remove")',
      assert: () => {
        expect(cssRules).toContain('@theme');
        expect(cssRules).not.toContain('@custom-variant');
        expect(cssRules).not.toContain('prefers-color-scheme');
      },
    },
  },

  A48: {
    what: 'the cn() twMerge helper and the CVA-based primitives',
    verdict: kept(() => {
      expect(code('/src/lib/utils.ts')).toContain('twMerge');
      for (const p of [
        '/src/components/ui/Button.tsx',
        '/src/components/ui/Card.tsx',
        '/src/components/ui/KpiCard.tsx',
      ]) {
        expect(code(p)).toMatch(/cva\(|cn\(/);
      }
    }, '/src/components/ui/__tests__/KpiCard.honesty.test.tsx'),
  },

  A49: {
    what: 'build and tooling config — the alias in both places, port 4001, the warn ceiling',
    verdict: kept(() => {
      expect(fileExists('vite.config.ts')).toBe(true);
      expect(fileExists('vitest.config.ts')).toBe(true);
      expect(fileExists('tsconfig.app.json')).toBe(true);
    }, '/src/__tests__/buildConfig.contract.test.ts'),
  },

  A50: {
    what: 'tanstack react-table on exactly one page, with manualPagination and server pageCount',
    verdict: {
      kind: 'unsigned',
      dropped:
        '@tanstack/react-table is gone from package.json, package-lock.json and ' +
        'node_modules. It had ZERO importers after Task 18 put API Errors on DataList; ' +
        'lint had reported react-hooks/incompatible-library on it, meaning the React ' +
        'Compiler was skipping that whole component, and what the library contributed ' +
        'over a paginated list was one division. The CAPABILITY it carried — server-side ' +
        'pagination — is preserved and asserted at A17',
      needs: 'a founder tick in the Deliberately Dropped table. Not forged here.',
    },
  },

  A51: {
    what: 'per-row recency columns with deliberately different date formats per screen',
    verdict: kept(() => {
      const fmt = code('/src/lib/format.ts');
      // One module, several named formats — the register's point is that the
      // DIFFERENCE is deliberate, not that fourteen files each import date-fns.
      expect(fmt).toContain('export const fmt');
      const stragglers = Object.entries(SOURCES)
        .filter(([p]) => !p.includes('__tests__') && p !== '/src/lib/format.ts')
        .filter(([, s]) => /from 'date-fns'/.test(s))
        .map(([p]) => p);
      expect(stragglers).toEqual([]);
    }, '/src/lib/__tests__/format.test.ts'),
  },

  A52: {
    what: 'the SECOND Farmer Suffering Watchlist panel on Ops Live',
    verdict: kept(() => {
      const live = code('/src/pages/ops/OpsLivePage.tsx');
      expect(live).toContain('topSufferingFarms');
    }, '/src/pages/ops/__tests__/OpsLivePage.test.tsx'),
  },

  A53: {
    what: 'the nav badge slot',
    verdict: {
      kind: 'changed',
      shipped:
        'the slot is no longer empty. Task 26 filled it from useShouldCallToday, so the ' +
        'row’s own words — "fully styled, currently unpopulated, renders nothing today" — ' +
        'are out of date in the direction the register wanted',
      decidedBy: 'Task 26',
      assert: () => {
        expect(code('/src/app/navBadges.ts')).toContain('useShouldCallToday');
        expect(code('/src/app/AdminShell.tsx')).toContain('useNavBadges()');
      },
    },
  },

  A54: {
    what: 'the axios timeout and the BASE_URL fallback',
    verdict: {
      kind: 'changed',
      shipped:
        'timeout: 20_000 is kept verbatim. The fallback is NOT: the registered value, ' +
        'http://localhost:5001, is a port nothing has ever listened on, and the row ' +
        'itself calls that a silent failure. It is now 5048 — the port the API actually ' +
        'uses — and falling back at all is audible, at error level in a PROD bundle',
      decidedBy: 'Task 11, after it cost a task of debugging',
      assert: () => {
        const api = code('/src/lib/api.ts');
        expect(api).toContain('timeout: 20_000');
        expect(api).toContain("const DEV_API_FALLBACK = 'http://localhost:5048'");
        expect(api).not.toContain('localhost:5001');
      },
    },
  },

  A55: {
    what: 'the North Star chart’s anti-rescaling honesty property',
    verdict: {
      kind: 'changed',
      shipped:
        'THE MECHANISM IS GONE AND THE PROPERTY IS ONLY HALF KEPT — the founder should ' +
        'look at this one. recharts was removed in Task 27, so there is no fixed [0,7] ' +
        'domain and no ReferenceLine; the series is a Sparkline scaled to the highest ' +
        'reading IN THE WINDOW, which is the floating axis A55 warned about. Two things ' +
        'hold the honesty up instead: the scaling is stated in words under the chart, ' +
        'and the goal is drawn as a separate fixed-100% bar whose figure comes from the ' +
        'server and is never printed from client code',
      decidedBy: 'Tasks 21 and 27 — needs the founder’s eye, not a tick',
      assert: () => {
        const nsm = code('/src/pages/metrics/NorthStarPage.tsx');
        // No client-side 4.5 anywhere: that was the fabrication half of A55.
        expect(nsm).not.toMatch(/\?\?\s*'?4\.5/);
        expect(nsm).toContain('data-goal-fill');
        expect(code('/src/components/data/Sparkline.tsx')).toContain('const span = max || 1;');
      },
    },
  },

  A56: {
    what: 'StrictMode double-invokes effects in dev, which FarmerSearchBox depends on',
    verdict: {
      kind: 'manual',
      gate:
        'Founder Acceptance Gate §2 — "Cmd-K finds a Marathi farmer" and §1 item 10, the ' +
        'farmer-search walk. A dev-only runtime behaviour cannot be read from a static ' +
        'sweep, and mounting StrictMode in a test does not reproduce a dev build',
    },
  },

  A57: {
    what: 'the two rule-definition subtitles — the only place either list states its rule',
    verdict: kept(() => {
      expect(code('/src/hooks/useShouldCallToday.ts')).toContain('SUFFERING_ENTRY_RULE');
      expect(code('/src/hooks/useShouldCallToday.ts')).toContain('CHURN_ENTRY_RULE');
      expect(code('/src/pages/farms/SilentChurnPage.tsx')).toMatch(/14 days/);
    }, '/src/pages/farms/__tests__/SilentChurnPage.test.tsx', '/src/pages/farms/__tests__/SufferingPage.test.tsx'),
  },

  A58: {
    what: 'the breadcrumb, and NavLink end so Home is not active on every route',
    verdict: kept(() => {
      const shell = code('/src/app/AdminShell.tsx');
      expect(shell).toContain('humanizePath');
      expect(shell).toContain("end={n.to === '/'}");
    }, '/src/app/__tests__/AdminShell.test.tsx'),
  },

  A59: {
    what: 'tsconfig strictness, and the globals a bare it()/expect() needs',
    verdict: kept(() => {
      expect(fileExists('tsconfig.app.json')).toBe(true);
    }, '/src/__tests__/buildConfig.contract.test.ts'),
  },
};

/* ══════════════════════════════════════════════════════════ the roll-call ══ */

const IDS = Object.keys(REGISTER);

describe('the register is exhaustive — a gap is visible, not assumed', () => {
  it('holds A1 to A59 with no gap and no duplicate', () => {
    const expected = Array.from({ length: 59 }, (_, i) => `A${i + 1}`);
    expect(IDS).toEqual(expected);
  });

  it('gives every row exactly one verdict', () => {
    for (const id of IDS) {
      expect(`${id}: ${REGISTER[id].verdict.kind}`).toMatch(
        /: (kept|changed|manual|unsigned)$/,
      );
      expect(REGISTER[id].what.length).toBeGreaterThan(10);
    }
  });

  /**
   * THE COUNTS ARE PINNED ON PURPOSE.
   *
   * Without this, the honest way to make the suite green is to quietly move a
   * `changed` row to `kept`, or an `unsigned` row to anything at all. The
   * numbers below are a measurement of what this migration actually did, and
   * changing one has to be a deliberate edit with a reason beside it.
   */
  it('counts 41 kept, 16 changed, 1 manual and 1 awaiting a signature', () => {
    const tally = { kept: 0, changed: 0, manual: 0, unsigned: 0 };
    for (const id of IDS) tally[REGISTER[id].verdict.kind] += 1;
    expect(tally).toEqual({ kept: 41, changed: 16, manual: 1, unsigned: 1 });
  });

  /**
   * SIXTEEN ROWS OUT OF FIFTY-NINE DID NOT SHIP AS WRITTEN. That is a finding
   * about the register, not about the migration: every one was caught by a
   * task doing the work and reading the backend, and none of them by reading
   * the plan. Listed by id so the founder can walk them, and pinned so a
   * seventeenth cannot be absorbed silently.
   */
  it('names the rows that cannot be ticked as written', () => {
    const changed = IDS.filter((id) => REGISTER[id].verdict.kind === 'changed');
    expect(changed).toEqual([
      'A3', 'A5', 'A13', 'A16', 'A17', 'A24', 'A27', 'A33',
      'A38', 'A41', 'A43', 'A46', 'A47', 'A53', 'A54', 'A55',
    ]);
  });
});

describe('every row that CAN be asserted mechanically, is', () => {
  const assertable = IDS.filter((id) => {
    const v = REGISTER[id].verdict;
    return v.kind === 'kept' || v.kind === 'changed';
  });

  it.each(assertable)('%s', (id) => {
    const v = REGISTER[id].verdict as Extract<Verdict, { assert: () => void }>;
    try {
      v.assert();
    } catch (cause) {
      // The row id and the capability, in the failure message. A register that
      // fails saying only "expected true to be false" is a register nobody
      // will read.
      throw new Error(
        `PRESERVATION REGISTER ${id} FAILED — ${REGISTER[id].what}\n${(cause as Error).message}`,
      );
    }
  });
});

describe('the proof a row points at must still exist', () => {
  /**
   * `provenBy` names the file whose BEHAVIOURAL test covers the row. Naming a
   * file that has been renamed or deleted is how a register turns into
   * folklore, so the pointer is checked rather than trusted.
   */
  it('every named behavioural proof is a real file', () => {
    const missing: string[] = [];
    for (const id of IDS) {
      const v = REGISTER[id].verdict;
      if (v.kind !== 'kept') continue;
      for (const path of v.provenBy ?? []) {
        if (!fileExists(path)) missing.push(`${id} -> ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('and at least half the kept rows name one', () => {
    const named = IDS.filter((id) => {
      const v = REGISTER[id].verdict;
      return v.kind === 'kept' && (v.provenBy ?? []).length > 0;
    });
    expect(named.length).toBeGreaterThan(20);
  });
});

/* ═════════════════════════════════ what the register cannot claim ══════════ */

describe('B16 — PII masking is NOT satisfied, and this test says so', () => {
  /**
   * 🔴 DO NOT TICK B16. Four endpoints return unmasked farmer phone numbers to
   * every admin who can open the screen:
   *
   *   /shramsafal/admin/farms                GetFarmsListHandler      (Task 14)
   *   /shramsafal/admin/farms/silent-churn   GetSilentChurnHandler    (Task 15)
   *   /shramsafal/admin/farms/suffering      GetSufferingHandler      (Task 16)
   *   /shramsafal/admin/users                (no redactor either)     (Task 17)
   *
   * `IResponseRedactor` exists and is called by exactly two handlers —
   * `GetFarmerHealthHandler` and `GetCohortPatternsHandler`. Independently:
   * `ResponseRedactor` does not recurse into collections, and `RedactionMatrix`
   * never names `farmerName`, so switching it on for a list endpoint would not
   * mask a list anyway.
   *
   * THE FRONTEND HALF IS DONE, and that is all this file may assert: a
   * `98******10` renders partly hidden, a `**redacted**` renders as a
   * permission fact rather than as literal text, and neither can leak the day
   * the server starts masking. The other half is a BACKEND change, outside
   * this plan, and no frontend edit can substitute for it.
   */
  it('renders whatever masking the server sends, and cannot leak the marker as text', () => {
    const redaction = code('/src/components/state/redaction.ts');
    expect(redaction).toContain('**redacted**');
    expect(redaction).toContain('export function isPartlyMasked');
    expect(redaction).toContain('export function isRedacted');
    /* THREE states, not two. `none` / `partial` / `redacted` — because
       `98******10` and `**redacted**` are different facts about what the server
       was willing to tell this reader, and a boolean would print the marker as
       if it were a phone number. */
    expect(code('/src/components/state/Masked.tsx')).toContain('maskState(');
    expect(code('/src/components/state/Masked.tsx')).toContain("state === 'redacted'");
  });

  it('does not claim the server masks anything', () => {
    // If a future task ever ticks B16, this is the assertion it has to remove
    // deliberately — which is the point.
    const b16Satisfied = false;
    expect(b16Satisfied).toBe(false);
  });
});

describe('what still needs the founder’s signature', () => {
  /**
   * Three things were removed or left standing that the Deliberately-Dropped
   * table does not yet cover. None of them is signed here.
   *
   *  1. A50 — @tanstack/react-table, removed outright (see the row above).
   *  2. The THREE surviving §B legacy classes: `.chip-fresh` / `.chip-live` /
   *     `.chip-mat`, all on FreshnessChip.
   *
   *     HALF OF THIS ITEM CLOSED ON 2026-09-02, AND IT CLOSED BY REVERSAL.
   *     They were listed here because they are translucent `color-mix()`
   *     fills and CONTRACT.md §8 banned translucency. The founder overruled
   *     §8 that day — "use the Glass morphism effect … to highlight the
   *     aesthetics" — so translucency is now the house style and these three
   *     stopped being a violation. `.glass-panel` came BACK with that
   *     reversal, as one of §A.12's six new surfaces; the v2 class of the
   *     same name, with its three-stop gradient bar and its `--radius-card`
   *     token, is still gone, and the assertion below proves the difference
   *     by declaration rather than by anyone remembering it.
   *
   *     WHAT STILL NEEDS A SIGNATURE is the half that was always the real
   *     one: FreshnessChip's green and teal say where a number came from — a
   *     live read versus last night's materialisation — which is a claim
   *     about data. No styling pass restyles a colour that states a fact, so
   *     this one is still the founder's.
   *  3. `--font-mono`, six files and eighteen uses, every one a value read
   *     character by character — the OTP field, error timestamps, status
   *     codes. §8 bans monospace. Sweep, or amend §8.
   *
   * The counts are asserted so the question cannot be closed by drift.
   */
  it('counts the three §B classes still standing, with their named consumer', () => {
    /* DECLARATIONS, not prose. The §B header LISTS the deleted classes by
       name in a comment explaining that they are gone, so reading the raw
       file reports every one of them as still present — the register failing
       on its own explanation, which is how an explanation gets deleted. */
    const css = cssRules;
    const boundary = (cls: string) =>
      new RegExp(`(?<![A-Za-z0-9_-])\\.${cls}(?![A-Za-z0-9_-])`);

    for (const cls of ['chip-fresh', 'chip-live', 'chip-mat']) {
      expect(`${cls} declared: ${boundary(cls).test(css)}`).toBe(`${cls} declared: true`);
    }
    /* BACK TO FOUR, AND THE ONE THAT LEFT THE LIST LEFT BY REVERSAL.
       `glass-panel` was on this list from 2026-09-02 morning, when
       ForbiddenPage was restyled onto §A and the v2 class was deleted. The
       founder reversed CONTRACT.md §8 the same day and the NAME is in use
       again, so asserting it is absent would now be asserting something
       false. The four below are the v2 classes proper: they are still gone,
       they still have no consumer, and none of them is what §A.12 built.

       The hyphen is why this needs an explicit boundary: `\bglass\b`
       matches inside `glass-panel`, which is the exact trap Task 28 caught —
       and it is exactly the trap that would let this assertion pass while
       reporting on the wrong class. */
    for (const cls of ['glass', 'glass-kpi', 'glass-sidebar', 'nav-active']) {
      expect(`${cls} declared: ${boundary(cls).test(css)}`).toBe(`${cls} declared: false`);
    }

    /* THE PROOF THAT THE NAME CAME BACK WITHOUT THE CLASS. The v2 rule
       carried a `::before` gradient bar and read a `--radius-card` token of
       its own. §A.12's rule carries neither, and both of those are still
       absent from the stylesheet. A name can be reused; a decorative
       gradient bar on every panel was a separate decision and it was not
       reversed. */
    expect(`glass-panel declared: ${boundary('glass-panel').test(css)}`).toBe(
      'glass-panel declared: true'
    );
    expect(css).not.toContain('.glass-panel::before');
    expect(css).not.toContain('--radius-card');
    expect(code('/src/components/ui/FreshnessChip.tsx')).toContain('chip-fresh');
  });

  it('counts the font-mono uses, so "we will sweep it later" has a number', () => {
    const users = Object.entries(SOURCES)
      .filter(([p]) => !p.includes('__tests__'))
      .filter(([, s]) => /font-mono/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')))
      .map(([p]) => p);

    expect(users.length).toBe(6);
  });

  it('records that @tanstack/react-table is gone and unsigned', () => {
    const a50 = REGISTER.A50.verdict;
    expect(a50.kind).toBe('unsigned');
    // An IMPORT, not a mention. Four files discuss the removal in prose, and a
    // register that went red on its own explanation is a register people
    // delete the explanation from.
    const importers = Object.entries(SOURCES)
      .filter(([, source]) => /from '@tanstack\/react-table'/.test(source))
      .map(([path]) => path);
    expect(importers).toEqual([]);

    const pkg = readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8');
    expect(pkg).not.toContain('@tanstack/react-table');
  });
});
