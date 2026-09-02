import { useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2 } from 'lucide-react';
import { useActiveOrg } from '@/app/ActiveOrgProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { MembershipSummary } from '@/hooks/useAdminScope';

interface OrgSwitcherProps {
  memberships: ReadonlyArray<MembershipSummary>;
  /** When true the switcher fills the viewport (used on 428 / NotInOrg paths). */
  fullPage?: boolean;
  /** Optional copy shown above the list — context-specific. */
  headline?: string;
  subline?: string;
}

/**
 * THE FULL-PAGE ORGANISATION GATE.
 *
 * Renders one-click pickers for each membership the user has. Writes the
 * selection to ActiveOrgProvider (url + localStorage) and invalidates the scope
 * query so the resolver is asked again with the new header.
 *
 * WHERE THIS IS USED, AND WHERE IT IS NOT. It is the full-page gate on the
 * `Ambiguous` and `NotInOrg` resolver outcomes — it blocks the shell entirely
 * until a selection is made. The compact topbar variant this file's header used
 * to promise was built in Task 10 and lives in `AdminShell.tsx` (`OrgScope`),
 * because it has to sit inside the topbar's layout and read the RESOLVED scope
 * as well as the selection. There is one switcher per situation, not two
 * implementations of one switcher.
 *
 * ── THE RELOAD IS GONE (Task 12 Step 3, D17) ──────────────────────────────
 * Choosing used to be followed by a `Continue` button whose only action was
 * `window.location.reload()`. The reload existed because every DATA query key
 * omitted the org, so nothing short of throwing the whole application away
 * could stop the previous tenant's rows being served to the next one. Task 12
 * put the org in all twelve data keys, so a switch now changes the key, and a
 * key that has changed cannot be answered from the old organisation's cache.
 *
 * Deleting the button is the honest end of that: selecting an organisation IS
 * the continue. The scope refetches on the new key, `RequireScope` re-renders,
 * and the shell opens. A button that reloads the page to make something happen
 * that has already happened is an affordance describing a console that no
 * longer exists.
 *
 * ── RESTYLED OFF THE LEGACY LAYER, 2026-09-02 ─────────────────────────────
 * This component held three §B tokens alive on its own — `surface-panel`,
 * `surface-border` and `surface-border-strong`, all three `color-mix()`
 * translucencies — plus two of the three legacy near-blacks. It is the gate a
 * multi-org admin meets BEFORE the shell, so it is the second thing the
 * console shows anyone, and it was drawn from a palette no other screen used.
 * It is now brand green on the token layer: `border-brand` + `brand-wash` for
 * the chosen organisation, a plain hairline for the rest.
 *
 * The border dropped from 2px to 1px because the selected state no longer
 * needs weight to be legible — it has a fill.
 */
export function OrgSwitcher({ memberships, fullPage = false, headline, subline }: OrgSwitcherProps) {
  const { activeOrgId, setActiveOrgId } = useActiveOrg();
  const qc = useQueryClient();

  const choose = (orgId: string) => {
    setActiveOrgId(orgId);
    /*
     * Invalidate rather than reset, and only the scope key.
     *
     * Picking a DIFFERENT org already changes the scope key, so this call is
     * about the other case: re-picking the org that is already selected, which
     * is the only move available to someone the resolver has just refused. The
     * key does not change then, so nothing would refetch and the screen would
     * not move. Invalidate makes the retry mean something.
     *
     * No data queries are touched because none are mounted — this component
     * only ever renders as the gate ABOVE the shell.
     */
    qc.invalidateQueries({ queryKey: ['admin', 'me', 'scope'] });
  };

  const body = (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <Building2 className="size-5" />
          {headline ?? 'Choose your active organization'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {subline && <p className="mb-4 text-body text-text-2">{subline}</p>}
        <ul className="space-y-2">
          {memberships.map((m) => {
            const selected = activeOrgId === m.orgId;
            return (
              <li key={m.orgId}>
                <button
                  type="button"
                  onClick={() => choose(m.orgId)}
                  className={`flex w-full items-center justify-between rounded-chip border p-4 text-left transition-colors ${
                    selected
                      ? 'border-brand bg-brand-wash'
                      : 'border-line hover:border-brand hover:bg-wash'
                  }`}
                >
                  <div>
                    <div className="text-h3 font-semibold text-text-1">{m.orgName}</div>
                    <div className="text-caption text-text-2">
                      {m.orgType} &middot; {m.orgRole}
                    </div>
                  </div>
                  {selected && <CheckCircle2 className="size-5 text-brand" aria-label="Selected" />}
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );

  if (!fullPage) return body;

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-2xl">{body}</div>
    </div>
  );
}
