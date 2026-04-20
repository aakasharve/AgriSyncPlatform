/**
 * farmInviteStore — persists a stable farm code per farm on-device.
 *
 * The real backend will own this: one `FarmInvitation` (and one active
 * `FarmJoinToken`) per farm, regeneratable but stable by default. Until
 * then we keep a per-farm code in localStorage so the farmer's QR does
 * not change every time they open the invite sheet, which is the
 * single most important UX property for semi-literate users ("the code
 * my mukadam already has still works").
 */

import { issueFarmInvite, type FarmInviteQr, type JoinRole } from './qrTokenClient';

const STORAGE_KEY = 'shramsafal_farm_invite_v1';

interface PersistedInvite {
    farmId: string;
    farmName: string;
    farmCode: string;
    proposedRole: JoinRole;
    token: string;
    qrPayload: string;
    issuedAtUtc: string;
}

type InviteStore = Record<string, PersistedInvite>;

const readStore = (): InviteStore => {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as InviteStore;
        }
        return {};
    } catch {
        return {};
    }
};

const writeStore = (store: InviteStore): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        // Storage full / denied — silent, the QR is still usable in-memory.
    }
};

export const getOrIssueFarmInvite = (farmId: string, farmName: string): FarmInviteQr => {
    const store = readStore();
    const existing = store[farmId];
    if (existing) {
        return {
            farmId: existing.farmId,
            farmName,
            farmCode: existing.farmCode,
            proposedRole: existing.proposedRole,
            token: existing.token,
            qrPayload: existing.qrPayload,
            issuedAtUtc: existing.issuedAtUtc,
        };
    }

    const fresh = issueFarmInvite({ farmId, farmName });
    store[farmId] = {
        farmId: fresh.farmId,
        farmName: fresh.farmName,
        farmCode: fresh.farmCode,
        proposedRole: fresh.proposedRole,
        token: fresh.token,
        qrPayload: fresh.qrPayload,
        issuedAtUtc: fresh.issuedAtUtc,
    };
    writeStore(store);
    return fresh;
};

export const rotateFarmInvite = (farmId: string, farmName: string): FarmInviteQr => {
    const store = readStore();
    const fresh = issueFarmInvite({ farmId, farmName });
    store[farmId] = {
        farmId: fresh.farmId,
        farmName: fresh.farmName,
        farmCode: fresh.farmCode,
        proposedRole: fresh.proposedRole,
        token: fresh.token,
        qrPayload: fresh.qrPayload,
        issuedAtUtc: fresh.issuedAtUtc,
    };
    writeStore(store);
    return fresh;
};

export const recordJoinAttempt = (
    farmCode: string,
    token: string,
    outcome: 'pending-phone' | 'verified' | 'failed'
): void => {
    // Lightweight telemetry for the demo phase; real backend will emit
    // FarmInvitationClaimed.v1 / FarmMembershipCreated.v1 via Outbox.
    if (typeof window === 'undefined') return;
    try {
        const key = 'shramsafal_join_attempts_v1';
        const raw = window.localStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
            list.push({
                farmCode,
                tokenPreview: `${token.slice(0, 6)}…${token.slice(-4)}`,
                outcome,
                atUtc: new Date().toISOString(),
            });
            window.localStorage.setItem(key, JSON.stringify(list.slice(-20)));
        }
    } catch {
        // best-effort only
    }
};
