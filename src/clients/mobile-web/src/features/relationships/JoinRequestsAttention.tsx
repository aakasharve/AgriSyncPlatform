/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6, "owner side"). Joining requests on लक्ष द्या:
 * "X आत येऊ इच्छितात · मंजूर / नको", lifted from the team page so the owner sees a waiting person on the screen he opens for
 * attention, not only deep in माझी टीम. The SAME decision flow, with reasons: the same request card, the same decisions
 * (`useMembershipDecisions`), the same one tap for a claim that came from an invitation. The PRIMARY account holder alone
 * decides (D-22), so only his phone asks for the roster.
 */
import React, { useState } from 'react';
import { SectionHead } from '../../shared/components/ui/placeUi';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import { isPrimaryAccountHolderRole } from '../../core/session/farmAuthorities';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { useLabourPermissions } from '../profile/hooks/useLabourPermissions';
import { useMembershipDecisions } from '../profile/hooks/useMembershipDecisions';
import { JoinRequestCard } from '../profile/team/JoinRequestCard';
import { nameFor, splitRoster } from '../profile/team/teamModel';
import { useFarmPlots } from '../profile/team/useFarmPlots';
import { invitationCopy } from '../invitations/invitationCopy';
import { approveInvitationClaim, invitationRefusal, type InvitationRefusal } from '../invitations/personalInvitationClient';
import { useInvitedFor } from '../invitations/useInvitedFor';
import { relationshipCopy } from './relationshipCopy';

export const JoinRequestsAttention: React.FC = () => {
    const farmContext = useOptionalFarmContext();
    const language = useOptionalLanguage()?.language;
    const copy = relationshipCopy(language);
    const invite = invitationCopy(language);
    const farm = farmContext?.currentFarm ?? null;
    const farmId = farm && isPrimaryAccountHolderRole(farm.role) ? farm.farmId : null;
    const roster = useLabourPermissions(farmId);
    const decisions = useMembershipDecisions(farmId, roster.adoptRow, roster.reload);
    const farmPlots = useFarmPlots(farmId);
    const [sentKey, setSentKey] = useState(0);
    const invitedFor = useInvitedFor(farmId, sentKey);
    const [inviteRefusal, setInviteRefusal] = useState<InvitationRefusal | null>(null);

    if (!farmId) return null;
    const { requests } = splitRoster(roster.rows);
    // A roster that could not be read is "unknown", never "nobody is waiting": say so with a retry (P4).
    if (roster.loadFailed && requests.length === 0) {
        return (
            <section className="space-y-2" data-testid="attention-requests-failed">
                <p className="m-0 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] font-bold text-amber-900">{copy.requests.loadFailed}</p>
                <button type="button" onClick={() => void roster.reload()} data-testid="attention-requests-retry"
                    className="min-h-[44px] rounded-full bg-white px-4 text-[14px] font-extrabold text-amber-900 ring-1 ring-amber-300">
                    {copy.requests.retry}
                </button>
            </section>
        );
    }
    if (requests.length === 0) return null;

    const busy = (userId: string) => decisions.busyUserId === userId || roster.savingUserId === userId;
    const letIn = async (invitationId: string) => {
        setInviteRefusal(null);
        try {
            roster.adoptRow(await approveInvitationClaim(farmId, invitationId));
        } catch (error) {
            setInviteRefusal(invitationRefusal(error, 'owner'));
        }
        await roster.reload();
        setSentKey(k => k + 1);
    };

    return (
        <section className="space-y-2" data-testid="attention-requests">
            <SectionHead title={copy.requests.title(requests.length)} />
            {(decisions.error || inviteRefusal) && (
                <p role="alert" data-testid="attention-requests-error"
                    className="m-0 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-800">
                    {inviteRefusal ? invite.refusal[inviteRefusal] : decisions.error?.message}
                </p>
            )}
            <ul className="m-0 space-y-2.5 p-0">
                {requests.map(row => (
                    <JoinRequestCard key={row.userId} row={row} name={nameFor(row, [])} busy={busy(row.userId)}
                        farmPlots={farmPlots}
                        invitedFor={row.personalInvitationId ? invitedFor.get(row.personalInvitationId) : undefined}
                        onLetInFromInvitation={row.personalInvitationId ? () => void letIn(row.personalInvitationId as string) : undefined}
                        onApprove={(preset, plots) => void decisions.approve(row.userId, preset, plots)}
                        onDecline={reason => void decisions.decline(row.userId, reason)} />
                ))}
            </ul>
        </section>
    );
};

export default JoinRequestsAttention;
