import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { LoadFailed, LoadingState, NotMeasured, NotMeasuredPanel } from '@/components/state';
import { useAdminScope } from '@/hooks/useAdminScope';

/**
 * ADMIN USERS — the screen with no endpoint, and that is the whole point of it.
 *
 * ── 🔴 WHAT WAS HERE (Step 1) ────────────────────────────────────────────
 * A module-scope constant:
 *
 *     const SEEDED_ADMINS = [
 *       { userId: '00000000-…-099', phone: '0000000000', note: 'Seeded admin (config)' },
 *     ];
 *
 * rendered inside a `<table>` with a green **Active** pill. It is data-shaped
 * and it is not data. Nothing fetched it, nothing could refresh it, and nothing
 * would have changed on this screen if every admin in the product had been
 * removed. A green pill is a verdict — "this account can open the console right
 * now" — and no check was made.
 *
 * It was described as *"a copy of what the config allow-list contained on the
 * day the file was written."* Measured, it is not even that:
 *   · `appsettings.Development.json:110-113` lists **TWO** ids. The table showed
 *     one, and dropped the other silently.
 *   · `appsettings.json` and `appsettings.Production.json` contain **no
 *     `Admins` section at all** — so in production the array this row claimed to
 *     mirror is empty, and the id shown here is a development seed id.
 *
 * ── 🛑 AND THE CONFIG IS NO LONGER WHAT IS READ ──────────────────────────
 * The plan's own premise is *"the config allow-list is what is read"*. That was
 * true before the W0-B admin pivot and is false now, verified in three places:
 *
 *   · `JwtTokenIssuer.cs:44-48` — *"prior to W0-B, this issuer also stamped a
 *     `membership: shramsafal:admin` claim for userIds listed in
 *     appsettings.Admins[]. **That path is removed.**"*
 *   · `AdminScopeHelper.cs` — every admin endpoint resolves through
 *     `IEntitlementResolver` and the file says *"No claim inspection for
 *     authorization — that's the whole point of the pivot."*
 *   · `EntitlementResolver.cs:38-47` — the resolver reads
 *     `ssf.organization_memberships` joined to `ssf.organizations`, per request.
 *
 * `Admins[]` survives only as an input to `PlatformAdminBridgeSeeder`, which
 * runs at API startup and ensures a Platform+Owner membership row exists for
 * each listed id. Its own header calls itself *"transitional"* and says to
 * remove it once UI-driven admin management lands.
 *
 * ── 🛑 `ssf.admin_users` DOES NOT EXIST ──────────────────────────────────
 * The copy this file used to ship said: *"Full DB-backed admin management …
 * `ssf.admin_users` table, IAdminResolver union config+DB, audit events … The
 * migration and IAdminResolver are ready — run the migration to activate."*
 *
 * Searched repo-wide across `.cs`, `.json` and `.sql`: **`admin_users` appears
 * nowhere, and `IAdminResolver` appears nowhere.** There is no migration to run
 * and no resolver to union with. The plan's softer phrasing — *"its migration
 * has not been run"* — implies a migration exists. It does not.
 *
 * That migration is scoped OUT of this plan regardless (it would be a production
 * database change), and nothing here runs it or asks anyone to.
 *
 * ── A4: THE ROUTE STAYS UNGATED, AND SO DOES THE GAP ─────────────────────
 * `App.tsx:311-315`. There is no `ModuleKey` for admin management, and
 * `EntitlementGuard` fails closed, so a guard here could only be handed a key
 * that does not exist — which would lock every admin out of this screen,
 * including the founder. Task 2's characterisation recorded that this screen has
 * no permission lock at all; that gap is in the decision ledger and is
 * deliberately NOT closed here. What this file will not do is write copy that
 * lets a reader think it is protected — see the last panel.
 */

/* ═════════════════════════════════════════════════════ your own access ══ */

/**
 * THE ONE MEASURED THING THIS SCREEN CAN SHOW.
 *
 * There is no endpoint that lists admins, so no roster is possible. There IS an
 * endpoint that answers, for the signed-in account only, what the server
 * resolved it to: `GET /shramsafal/admin/me/scope`, which this console already
 * calls on every page through `AdminAuthProvider` and `EntitlementGuard`. Read
 * through the same hook, so this block costs no extra request — it is a cache
 * read of an answer the page already has.
 *
 * It is deliberately headed with the word "your". One account is not a list, and
 * a reader must not be able to mistake this for one.
 */
function YourAccess() {
  const { isLoading, isError, error, outcome, scope, memberships } = useAdminScope();

  if (isLoading) return <LoadingState label="Loading your admin scope" height={120} />;

  if (isError) {
    /* A41 — a failure is named as one and is retryable. The retry is a reload
       rather than a refetch because this query is owned by the auth provider
       above this screen; refetching it from here would leave the provider
       holding the failed result. */
    return (
      <LoadFailed
        error={error}
        onRetry={() => window.location.reload()}
        what="your admin scope"
      />
    );
  }

  const readable = scope?.modules.filter((m) => m.canRead).length ?? 0;
  const total = scope?.modules.length ?? 0;

  return (
    <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
      <Fact label="Outcome">{outcome ?? <NotMeasured why="The server did not answer." />}</Fact>
      <Fact label="Organisation">
        {scope ? (
          <>
            {memberships.find((m) => m.orgId === scope.orgId)?.orgName ?? scope.orgId}{' '}
            <span className="text-text-3">
              ({scope.orgType} · {scope.orgRole})
            </span>
          </>
        ) : (
          <NotMeasured why="No organisation resolved for this account." />
        )}
      </Fact>
      <Fact label="Platform admin">
        {scope ? (scope.isPlatformAdmin ? 'Yes' : 'No') : <NotMeasured />}
      </Fact>
      <Fact label="Modules you can read">
        {scope ? (
          <>
            {readable} of {total}
          </>
        ) : (
          <NotMeasured />
        )}
      </Fact>
      <Fact label="Organisations you belong to">
        {/* A real count of a real list — this one the server does send. */}
        {memberships.length}
      </Fact>
      <Fact label={<>Everyone else&rsquo;s access</>}>
        {/* The point of the screen, in the shape of a field: this is where a
            roster would be, and there is nothing behind it. */}
        <NotMeasured why="No endpoint in this API returns the list of admins." />
      </Fact>
    </dl>
  );
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-3">{label}</dt>
      <dd className="text-text-1">{children}</dd>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ the page ═══ */

export default function SettingsAdminsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
          <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
          Admin Users
        </h1>
        {/* v3's subtitle: "The allow-list that decides who can open this
            console. Signing in with a one-time code is the first gate; being on
            this list is the second." The two gates are real and are kept. The
            word "list" is not: what decides is a membership row in the database,
            and this console cannot read who holds one. */}
        <p className="mt-1 text-body text-text-2">
          Who can open this console, and what that grants them. Signing in is the first gate; holding
          an active organisation membership is the second. <b>This console cannot list who holds
          one</b> &mdash; nothing below is a roster.
        </p>
      </div>

      {/* ── STEP 1 + 2: what replaced the hardcoded row ──────────────────
          §6.4 — a whole panel with no data source at all, which is a different
          thing from a broken one. */}
      <NotMeasuredPanel
        title="There is no admin list to show"
        why={
          <>
            <p>
              No endpoint in this API returns the accounts that can open this console, so this screen
              has nothing to fetch and nothing to count. <b>Until this task it showed one row
              anyway</b> &mdash; a single account id, a phone number and a green &ldquo;Active&rdquo;
              pill, written into the page as a constant. Nothing checked it, nothing could refresh it,
              and it would have looked exactly the same if every admin in the product had been
              removed.
            </p>
            <p className="mt-2">
              It was not even a faithful copy of the configuration it was taken from: that file lists{' '}
              <b>two</b> accounts and this screen showed one, and the production configuration lists{' '}
              <b>none at all</b>.
            </p>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Your own access, as the server resolved it</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-[14px] text-text-2">
            One account &mdash; the one signed in. This is the only thing on this page that was
            measured rather than described, and it is read from the same answer every screen in this
            console is gated on.
          </p>
          <YourAccess />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where admin access actually comes from</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-[14px] text-text-2">
          <p>
            <b>At request time, from the database.</b> Every admin request resolves the caller
            against their active, non-expired organisation memberships and the organisations those
            point at. Nothing is read from the sign-in token: a grant takes effect on the{' '}
            <b>next request</b>, with no sign-out and no new token.
          </p>
          <p>
            <b>The configuration file is a starting seed, not the source.</b> A list of account ids
            in the API&rsquo;s own settings is read once, at start-up, and used to make sure each of
            those accounts has a platform membership. It is present only in the development settings.
            The production settings carry no such list, so on the production API that step does
            nothing at all.
          </p>
          <p>
            <b>The second source this screen has promised for months does not exist.</b> It used to
            say a database-backed list of admins was built and only needed switching on. There is no
            such list anywhere in this product, nothing to switch on, and no second set of names to
            combine with the first.
          </p>
          <p>
            <b>There is no way to change any of this from here.</b> Adding or removing an admin is a
            database change, or a settings change plus an API restart. This console has no write
            surface for it, and this screen is read-only by design rather than by omission.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What admin access grants</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-[14px] text-text-2">
          {/* v3: "Access here is all or nothing. Being on this list means every
              farmer's phone number and every farm's logs; being off it means a
              403 at the door. There is nothing in between."

              TRUE OF PLATFORM MEMBERSHIP, AND ONLY OF IT. `EntitlementMatrix`
              answers every module key with (read, export, write) per
              organisation TYPE and ROLE. Platform+Owner is `(true, true, …)`
              for every key and Platform+Analyst is `(true, …)` for every key —
              so for a platform admin there really is nothing in between. FPO,
              FPC, consulting-firm and lab memberships get a per-module set that
              is genuinely graduated, which is the in-between v3 says does not
              exist. Both are stated; neither is softened. */}
          <p>
            <b>Platform access is all or nothing.</b> A platform owner can read and export{' '}
            <b>every</b> module this console has: every farmer&rsquo;s phone number, every
            farm&rsquo;s logs, every error and every metric. A platform analyst can read all of it
            too. There is no way to grant one screen without granting the rest, and no setting that
            narrows it.
          </p>
          <p>
            <b>Membership of an ordinary organisation is not all or nothing.</b> A farmer-producer
            organisation, a consulting firm or a lab is granted a specific set of modules by role,
            and several roles can read a farm list and nothing else. So the console does have an
            in-between &mdash; it is just not available to platform admins, who are the accounts this
            screen is about.
          </p>
          <p>
            <b>Being in no active organisation is refused at the door.</b> The request is answered
            unauthorised, and the console sends the reader to sign in again. A refusal for a{' '}
            <i>particular</i> organisation or a <i>particular</i> screen is a different answer and
            reads differently: it lands on the denial page with the module named.
          </p>
        </CardContent>
      </Card>

      {/* ── THE GAP, STATED AND DELIBERATELY NOT CLOSED ──────────────────
          The instruction for this task is exact: do not close it, and do not
          write copy that implies the screen is protected. Silence would do the
          second thing — a screen headed "Admin Users" reads as privileged
          unless it says otherwise. */}
      <NotMeasuredPanel
        title="This screen is not permission-gated"
        why={
          <p>
            Every other screen in this console is behind a per-module permission check. This one is
            not: any account whose admin scope resolves at all can open it, including roles whose
            only other readable screen is a farm list. It is deliberate rather than forgotten &mdash;
            there is no permission key for admin management, and a check against a key that does not
            exist refuses everyone, founder included. The gap is recorded in the decision ledger and
            is not closed by this change.
          </p>
        }
      />
    </div>
  );
}
