/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5, §6). The personal invitation's routes.
 *
 *   The owner (primary account holder only, D-26):
 *     POST /shramsafal/farms/{farmId}/personal-invitations            {label, name?, invitedPhone?, fieldOperatorId?,
 *                                                                      plotScope, plotIds?, authorities}  → 201 view
 *     GET  /shramsafal/farms/{farmId}/personal-invitations            → view[]
 *     POST /shramsafal/farms/{farmId}/personal-invitations/{id}/withdraw → view
 *     POST /shramsafal/farms/{farmId}/personal-invitations/{id}/approve  → the person's roster row (one tap)
 *   The invited person:
 *     GET  /shramsafal/invitations/mine                                → card[]   (also on /me/context, `invitations`)
 *     POST /shramsafal/invitations/find     {code}                     → card     (404 invitation.unknown)
 *     POST /shramsafal/invitations/accept   {invitationId? | code?}    → {farmId, farmName, status, membershipId, workerLinked}
 *     POST /shramsafal/invitations/decline  {invitationId? | code?}    → {status: "Declined"}
 *   409 {error: invitation.expired | invitation.used | invitation.declined | invitation.withdrawn |
 *        invitation.already_member}; 429 = too many tries (codes) or today's invitations made (farm).
 *
 * TRANSPORT: the app's one shared HTTP client (token, device id, one refresh-and-replay on 401). Every answer is the
 * server's truth; the screens adopt it and never assume a request landed.
 */
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';
import type { AuthorityGrant, LabourPermission } from '../profile/data/labourPermissionsClient';
import type { PlotScopeName } from '../profile/data/membershipAdminClient';

/** The labels an invitation may carry (the server's names). मालक is never handed out by an invitation. */
export type InvitationLabel = 'CoOwner' | 'Family' | 'Mukadam' | 'Worker';

export type InvitationStatus = 'Waiting' | 'Accepted' | 'Declined' | 'Withdrawn' | 'Expired';

export interface CreateInvitationBody {
    label: InvitationLabel;
    name?: string;
    invitedPhone?: string;
    fieldOperatorId?: string;
    plotScope: PlotScopeName;
    plotIds?: string[];
    authorities: AuthorityGrant[];
}

/** The owner's view of one invitation. */
export interface PersonalInvitationView {
    id: string;
    farmId: string;
    code: string;
    link: string;
    label: InvitationLabel;
    name: string | null;
    invitedPhoneLast4: string | null;
    fieldOperatorId: string | null;
    plotScope: PlotScopeName;
    plotIds: string[];
    plotNames: string[];
    authorities: AuthorityGrant[];
    status: InvitationStatus;
    createdAtUtc: string;
    expiresAtUtc: string;
    claimedByUserId: string | null;
    claimedAtUtc: string | null;
    waitsForOwner: boolean;
    workerLinked: boolean;
}

/** The invited person's card (no code, no farm id, no number). */
export interface InvitationCard {
    invitationId: string;
    farmName: string;
    invitedByName: string | null;
    label: InvitationLabel;
    name: string | null;
    plotScope: PlotScopeName;
    plotNames: string[];
    authorities: AuthorityGrant[];
    expiresAtUtc: string;
    /** Absent on /me/context (it lists waiting ones only). */
    status?: InvitationStatus;
    /** It named his proven number: स्वीकारा lets him in at once. Absent on /me/context (always true there). */
    namesYou?: boolean;
    namesAWorker: boolean;
}

export interface InvitationAccepted {
    farmId: string;
    farmName: string;
    status: 'Active' | 'PendingApproval' | string;
    membershipId: string;
    workerLinked: boolean;
}

/** How the server refused, as the screen must say it. */
export type InvitationRefusal =
    | 'unknown' | 'expired' | 'used' | 'declined' | 'withdrawn' | 'already_member'
    | 'rate_limited' | 'daily_cap' | 'forbidden' | 'invalid' | 'failed';

const ownerPath = (farmId: string): string => `/shramsafal/farms/${farmId}/personal-invitations`;

export async function createInvitation(farmId: string, body: CreateInvitationBody): Promise<PersonalInvitationView> {
    const response = await agriSyncClient.http.post<PersonalInvitationView>(ownerPath(farmId), body);
    return response.data;
}

export async function listInvitations(farmId: string): Promise<PersonalInvitationView[]> {
    const response = await agriSyncClient.http.get<PersonalInvitationView[]>(ownerPath(farmId));
    return Array.isArray(response.data) ? response.data : [];
}

export async function withdrawInvitation(farmId: string, invitationId: string): Promise<PersonalInvitationView> {
    const response = await agriSyncClient.http.post<PersonalInvitationView>(`${ownerPath(farmId)}/${invitationId}/withdraw`, {});
    return response.data;
}

export async function approveInvitationClaim(farmId: string, invitationId: string): Promise<LabourPermission> {
    const response = await agriSyncClient.http.post<LabourPermission>(`${ownerPath(farmId)}/${invitationId}/approve`, {});
    return response.data;
}

export async function findInvitation(code: string): Promise<InvitationCard> {
    const response = await agriSyncClient.http.post<InvitationCard>('/shramsafal/invitations/find', { code });
    return response.data;
}

/** स्वीकारा — by the card listed for his number, or by the code he holds. */
export async function acceptInvitation(answer: { invitationId?: string; code?: string }): Promise<InvitationAccepted> {
    const response = await agriSyncClient.http.post<InvitationAccepted>('/shramsafal/invitations/accept', answer);
    return response.data;
}

export async function declineInvitation(answer: { invitationId?: string; code?: string }): Promise<void> {
    await agriSyncClient.http.post('/shramsafal/invitations/decline', answer);
}

/** Structural (not `instanceof AxiosError`): the shared client's interceptor re-throws. */
export function invitationRefusal(error: unknown): InvitationRefusal {
    if (typeof error !== 'object' || error === null) return 'failed';
    const response = (error as { response?: { status?: number; data?: unknown } }).response;
    if (!response) return 'failed';
    const code = typeof response.data === 'object' && response.data !== null
        ? (response.data as { error?: unknown }).error
        : undefined;
    if (response.status === 429) return code === 'invitation.daily_cap' ? 'daily_cap' : 'rate_limited';
    if (response.status === 404) return 'unknown';
    if (response.status === 403) return 'forbidden';
    if (response.status === 400) return 'invalid';
    if (response.status === 409) {
        switch (code) {
            case 'invitation.expired': return 'expired';
            case 'invitation.used': return 'used';
            case 'invitation.declined': return 'declined';
            case 'invitation.withdrawn': return 'withdrawn';
            case 'invitation.already_member': return 'already_member';
            default: return 'failed';
        }
    }
    return 'failed';
}
