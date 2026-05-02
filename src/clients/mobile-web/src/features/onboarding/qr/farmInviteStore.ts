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
import {
    readInviteStoreRaw,
    writeInviteStoreRaw,
    readJoinAttemptsRaw,
    writeJoinAttemptsRaw,
} from '../../../infrastructure/storage/FarmInviteStore';

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
    try {
        const raw = readInviteStoreRaw();
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
    writeInviteStoreRaw(JSON.stringify(store));
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
    try {
        const raw = readJoinAttemptsRaw();
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
            list.push({
                farmCode,
                tokenPreview: `${token.slice(0, 6)}…${token.slice(-4)}`,
                outcome,
                atUtc: new Date().toISOString(),
            });
            writeJoinAttemptsRaw(JSON.stringify(list.slice(-20)));
        }
    } catch {
        // best-effort only
    }
};
