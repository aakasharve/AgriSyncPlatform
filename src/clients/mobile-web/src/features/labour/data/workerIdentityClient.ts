/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54). The phone's calls to the narrow
 * worker-identity routes (`WorkerIdentityEndpoints`): scan-resolve, the shared-number check, link (start + confirm),
 * the farm's PIN, a worker's phone and PIN, the one-time code and its check, and a new card. Only the calls a screen
 * makes are here (an unused wrapper would read as a shipped capability). ONLINE-ONLY like every field-operator write:
 * a failure throws and the caller says so — nothing is queued or claimed saved.
 *
 * Every path is written out in full so the route-match test (phoneRestPathsMatchServer) reads each one.
 * TRANSPORT: the app's ONE shared HTTP client (token, single-flight refresh), as fieldOperatorClient.
 *
 * @module features/labour/data/workerIdentityClient
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

export interface CardResolve {
    status: 'Active' | 'Retired';
    displayName: string | null;
    level: string | null;
}

export interface PhoneCheck {
    sameFarmNames: string[];
    verifiedHolderExists: boolean;
}

export interface LinkStart {
    ticket: string | null;
    codeSent: boolean;
    displayName: string | null;
    level: string | null;
}

export interface WorkerIdentityView {
    fieldOperatorId: string;
    displayName: string;
    cardCode: string | null;
    identityLevel: string;
    needsPhoneAndPin: boolean;
    phoneWhose?: string | null;
    phoneTail?: string | null;
    homePin?: string | null;
    sameNumberNames?: string[] | null;
}

export interface CodeSent {
    ticket: string;
    phoneTail: string;
}

export async function resolveCard(farmId: string, code: string): Promise<CardResolve> {
    const response = await agriSyncClient.http.post<CardResolve>(`/shramsafal/farms/${farmId}/labour/identity/resolve`, { code });
    return response.data;
}

export async function checkPhone(farmId: string, phone: string): Promise<PhoneCheck> {
    const response = await agriSyncClient.http.post<PhoneCheck>(`/shramsafal/farms/${farmId}/labour/identity/phone-check`, { phone });
    return response.data;
}

export async function startLink(farmId: string, body: { cardCode?: string; phone?: string }): Promise<LinkStart> {
    const response = await agriSyncClient.http.post<LinkStart>(`/shramsafal/farms/${farmId}/labour/identity/link/start`, body);
    return response.data;
}

/** Links him on THIS farm as a new team member (`id` keeps a retry from making a second one). */
export async function linkWorker(
    farmId: string,
    body: { cardCode?: string; ticket?: string; code?: string; id?: string; displayName?: string },
): Promise<WorkerIdentityView> {
    const response = await agriSyncClient.http.post<WorkerIdentityView>(`/shramsafal/farms/${farmId}/labour/identity/link`, body);
    return response.data;
}

/** The farm's own PIN, when the owner recorded one (the "शेताचाच पिन" chip). */
export async function fetchFarmPin(farmId: string): Promise<string | null> {
    const response = await agriSyncClient.http.get<{ pinCode: string | null }>(`/shramsafal/farms/${farmId}/labour/identity/farm-pin`);
    return response.data.pinCode ?? null;
}

/** "यांचा फोन व पिन भरा" — this farm's phone for him (tagged) and his PIN. */
export async function recordContact(
    farmId: string,
    fieldOperatorId: string,
    body: { phone?: string; phoneWhose?: string; homePin?: string },
): Promise<WorkerIdentityView> {
    const response = await agriSyncClient.http.put<WorkerIdentityView>(
        `/shramsafal/farms/${farmId}/labour/field-operators/${fieldOperatorId}/identity`, body);
    return response.data;
}

/** Screen 3 — a 4-digit code to the number this farm entered for him. */
export async function sendWorkerCode(farmId: string, fieldOperatorId: string): Promise<CodeSent> {
    const response = await agriSyncClient.http.post<CodeSent>(
        `/shramsafal/farms/${farmId}/labour/field-operators/${fieldOperatorId}/phone/send-code`, {});
    return response.data;
}

export async function verifyWorkerCode(farmId: string, fieldOperatorId: string, ticket: string, code: string): Promise<WorkerIdentityView> {
    const response = await agriSyncClient.http.post<WorkerIdentityView>(
        `/shramsafal/farms/${farmId}/labour/field-operators/${fieldOperatorId}/phone/verify`, { ticket, code });
    return response.data;
}

/** Case 13 — a lost or stolen card: a new code, the owner confirming him; the old code stops working. */
export async function reissueCard(farmId: string, fieldOperatorId: string): Promise<{ cardCode: string; retiredCardCode: string | null }> {
    const response = await agriSyncClient.http.post<{ cardCode: string; retiredCardCode: string | null }>(
        `/shramsafal/farms/${farmId}/labour/field-operators/${fieldOperatorId}/card/reissue`, { proof: 'OwnerConfirms' });
    return response.data;
}

/** The server's refusal code (`{ error }`), for the screen's own words; null when there is none. */
export function identityErrorCode(error: unknown): string | null {
    const data = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
    return typeof data?.error === 'string' ? data.error : null;
}
