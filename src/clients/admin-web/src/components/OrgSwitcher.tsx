import { useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2 } from 'lucide-react';
import { useActiveOrg } from '@/app/ActiveOrgProvider';
import { Button } from '@/components/ui/Button';
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
 * Renders one-click pickers for each membership the user has. Writes the
 * selection to ActiveOrgProvider (URL + localStorage) and invalidates the
 * scope query so downstream hooks refetch with the new header.
 *
 * Used in two places:
 *   - Full-page gate on Ambiguous / NotInOrg resolver outcomes (blocks
 *     the shell entirely until a selection is made)
 *   - Compact popover in the topbar for users with multiple memberships
 *     who want to switch between orgs mid-session
 */
export function OrgSwitcher({ memberships, fullPage = false, headline, subline }: OrgSwitcherProps) {
  const { activeOrgId, setActiveOrgId } = useActiveOrg();
  const qc = useQueryClient();

  const choose = (orgId: string) => {
    setActiveOrgId(orgId);
    // Refetch the scope immediately — without this, the next render still
    // sees the previous outcome until React Query's staleTime elapses.
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
        {subline && <p className="mb-4 text-sm text-text-muted">{subline}</p>}
        <ul className="space-y-2">
          {memberships.map((m) => {
            const selected = activeOrgId === m.orgId;
            return (
              <li key={m.orgId}>
                <button
                  type="button"
                  onClick={() => choose(m.orgId)}
                  className={`flex w-full items-center justify-between rounded-md border-2 p-4 text-left transition-colors ${
                    selected
                      ? 'border-brand-teal bg-surface-panel'
                      : 'border-surface-border hover:border-surface-border-strong hover:bg-surface-panel'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-text-primary">{m.orgName}</div>
                    <div className="text-xs text-text-muted">
                      {m.orgType} &middot; {m.orgRole}
                    </div>
                  </div>
                  {selected && <CheckCircle2 className="size-5 text-brand-teal" aria-label="Selected" />}
                </button>
              </li>
            );
          })}
        </ul>
        {fullPage && activeOrgId && (
          <div className="mt-6 text-right">
            <Button onClick={() => window.location.reload()}>Continue</Button>
          </div>
        )}
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
