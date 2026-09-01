import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import { ModuleKeys } from '@/lib/moduleKeys';
import SettingsAdminsPage from '../SettingsAdminsPage';

/**
 * ADMIN USERS — the screen whose only content was a constant.
 *
 * The claims this file exists to hold:
 *
 *  1. NO HARDCODED ROW. The old page rendered `SEEDED_ADMINS` — one account id,
 *     one phone number and a green "Active" pill — inside a `<table>`. Nothing
 *     fetched it and nothing could refresh it. The strongest possible assertion
 *     is used: those literal strings, and any table at all, are absent.
 *  2. IT SAYS WHERE ADMIN ACCESS REALLY COMES FROM, and does not repeat the
 *     "Phase 6 … run the migration to activate" copy — which named a migration
 *     and a resolver that do not exist anywhere in this repository.
 *  3. IT SHOWS ONE MEASURED THING — the reader's OWN resolved scope, from an
 *     endpoint the console already calls — and never presents it as a roster.
 *  4. IT DOES NOT IMPLY IT IS PROTECTED. Task 2 recorded that this route has no
 *     permission gate; that gap is not closed here, and the copy says so.
 *
 * SETTLE_WAIT — the 15 s pattern carried from Task 19 with its reason: under
 * full-suite parallelism a block has not always finished changing inside
 * Testing Library's 1000 ms default. `vitest.config.ts` is untouched.
 *
 * MOUNT BUDGET (Tasks 14, 18 and 24). Five mounts, fixtures shared, no
 * assertion dropped to hold it.
 */

const SETTLE_WAIT = 15_000;
const ORG = '11111111-1111-1111-1111-111111111111';

/** The account id and phone the old page printed as if they were data. */
const HARDCODED_ID = '00000000-0000-0000-0000-000000000099';
const HARDCODED_PHONE = '0000000000';

function scopeBody(over: Partial<MeScopeResponse> = {}): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'aaaaaaaa-0000-0000-0000-000000000001',
      orgId: ORG,
      orgType: 'Platform',
      orgRole: 'Owner',
      isPlatformAdmin: true,
      modules: [
        { key: ModuleKeys.FarmsList, canRead: true, canExport: true, canWrite: false },
        { key: ModuleKeys.OpsLive, canRead: true, canExport: true, canWrite: false },
        { key: ModuleKeys.OpsErrors, canRead: false, canExport: false, canWrite: false },
      ],
    },
    memberships: [
      { orgId: ORG, orgName: 'AgriSync Platform', orgType: 'Platform', orgRole: 'Owner' },
    ],
    ...over,
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serveScope(body: MeScopeResponse = scopeBody()) {
  stub = installAdapter(async () => ({ status: 200, data: body }));
  return stub;
}

function renderSettings(route = `/settings/admins?org=${ORG}`) {
  return renderWithProviders(<SettingsAdminsPage />, { route });
}

/* ══════════════════ 1. THE CONSTANT THAT LOOKED LIKE DATA ═══════════════ */

describe('🔴 the hardcoded admin row', () => {
  it('renders no admin row, no table and no Active pill', async () => {
    serveScope();
    renderSettings();

    await screen.findByText('There is no admin list to show', undefined, {
      timeout: SETTLE_WAIT,
    });

    /* The exact three values `SEEDED_ADMINS` printed. A test that only asserted
       "no table" would pass if the same constant were moved into a card. */
    expect(
      screen.queryByText(HARDCODED_ID),
      'the seeded admin id is a constant, not a measurement — it must not render anywhere',
    ).not.toBeInTheDocument();
    expect(screen.queryByText(HARDCODED_PHONE)).not.toBeInTheDocument();
    expect(screen.queryByText('Seeded admin (config)')).not.toBeInTheDocument();

    /* The green "Active" pill was the worst part: a verdict about an account
       nobody had checked. */
    expect(screen.queryByText('Active')).not.toBeInTheDocument();

    /* And no table at all — a roster shape over no roster. */
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();

    /* The old headings, which announced a list that did not exist. */
    expect(screen.queryByText(/Current Admins/i)).not.toBeInTheDocument();
    expect(screen.queryByText('User ID')).not.toBeInTheDocument();
  });
});

/* ═══════════════════ 2. THE SCAFFOLDING COPY, REPLACED ══════════════════ */

describe('the "Phase 6" copy, and what replaced it', () => {
  it('drops the developer-facing scaffolding and names the real source', async () => {
    serveScope();
    renderSettings();

    await screen.findByText('Where admin access actually comes from', undefined, {
      timeout: SETTLE_WAIT,
    });

    /* Written for a developer reading a plan, shipped to an operator. Every one
       of these named something that does not exist in the repository. */
    expect(screen.queryByText(/Phase 6/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/IAdminResolver/)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin_users/)).not.toBeInTheDocument();
    expect(screen.queryByText(/appsettings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/run the migration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/migration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/audit events/i)).not.toBeInTheDocument();

    /* What an operator gets instead: where the decision is actually made, that
       the configuration file is only a start-up seed, and that the promised
       second source is not there. */
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/At request time, from the database/i);
    expect(body).toMatch(/starting seed, not the source/i);
    expect(body).toMatch(/second source this screen has promised for months does not exist/i);
    expect(body).toMatch(/nothing to switch on/i);
    expect(body).toMatch(/no way to change any of this from here/i);
  });

  it('states the all-or-nothing rule for platform access AND the in-between the product has', async () => {
    serveScope();
    renderSettings();

    await screen.findByText('What admin access grants', undefined, { timeout: SETTLE_WAIT });

    const body = document.body.textContent ?? '';

    /* v3's sentence, kept: every farmer's phone number and every farm's logs. */
    expect(body).toMatch(/Platform access is all or nothing/i);
    expect(body).toMatch(/every farmer/i);
    expect(body).toMatch(/farm[’']s logs/i);

    /* And the correction v3 does not carry: `EntitlementMatrix` grants a
       graduated per-module set to FPO / FPC / consulting / lab memberships, so
       "there is nothing in between" is false of the product as a whole. */
    expect(body).toMatch(/not all or nothing/i);
    expect(body).toMatch(/console does have an in-between/i);
  });
});

/* ══════════════════ 3. THE ONE MEASURED THING ON THE PAGE ═══════════════ */

describe('your own access — measured, and never dressed as a roster', () => {
  it('reads the scope the console is already gated on, and does not fetch again', async () => {
    serveScope();
    renderSettings();

    /* Wait for the ANSWER, not for the heading. The card title is static text
       and resolves before the request has settled, which would assert against a
       shimmer. */
    await screen.findByText('Resolved', undefined, { timeout: SETTLE_WAIT });

    const panel = screen
      .getByText('Your own access, as the server resolved it')
      .closest('div.rounded-panel') as HTMLElement;

    expect(within(panel).getByText('Resolved')).toBeInTheDocument();
    expect(within(panel).getByText(/AgriSync Platform/)).toBeInTheDocument();
    expect(within(panel).getByText(/Platform · Owner/)).toBeInTheDocument();

    // Two of the three fixture modules carry canRead.
    expect(within(panel).getByText('2 of 3')).toBeInTheDocument();

    // One account is not a list, and the page says so in the same breath.
    expect(within(panel).getByText(/One account/i)).toBeInTheDocument();

    // The slot where a roster would be, holding the absence rather than a count.
    expect(within(panel).getByText(/Everyone else/i)).toBeInTheDocument();
    expect(within(panel).getAllByText('not measured').length).toBeGreaterThan(0);

    // Only ONE endpoint is touched, and it is the scope endpoint every screen
    // already calls — this block invents nothing.
    expect(stub!.requests.map((r) => r.url)).toEqual(['/shramsafal/admin/me/scope']);
  });

  it('names a broken scope request as broken rather than showing an empty roster', async () => {
    stub = installAdapter(async () => ({ status: 500, data: { message: 'boom' } }));
    renderSettings();

    const failure = await screen.findByRole('alert', undefined, { timeout: SETTLE_WAIT });
    expect(within(failure).getByRole('button', { name: /retry/i })).toBeInTheDocument();

    // An empty allow-list is not a tidy screen, it is a locked door. Neither
    // reading may be produced by a 500.
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('announces the wait instead of rendering an empty scope', async () => {
    stub = installAdapter(neverSettles);
    renderSettings();

    expect(
      await screen.findByRole(
        'status',
        { name: 'Loading your admin scope' },
        { timeout: SETTLE_WAIT },
      ),
    ).toBeInTheDocument();
  });
});

/* ════════════ 4. THE GAP: STATED, NOT CLOSED, NOT IMPLIED AWAY ══════════ */

describe('the missing permission gate is stated, not closed', () => {
  it('says the screen is not permission-gated, and does not claim to be protected', async () => {
    serveScope();
    renderSettings();

    await screen.findByText('This screen is not permission-gated', undefined, {
      timeout: SETTLE_WAIT,
    });

    const body = document.body.textContent ?? '';
    expect(body).toMatch(/any account whose admin scope resolves at all can open it/i);
    /* Why it is not closed here: no key exists, and a check against a key that
       does not exist refuses everyone (A4). */
    expect(body).toMatch(/refuses everyone/i);

    /* And the copy that would imply the opposite. A screen headed "Admin Users"
       reads as privileged unless it says otherwise, so silence is not neutral. */
    expect(screen.queryByText(/only administrators/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/restricted/i)).not.toBeInTheDocument();
  });
});
