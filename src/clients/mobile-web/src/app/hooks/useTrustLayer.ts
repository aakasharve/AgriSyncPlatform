import { useCallback } from 'react';
import { DailyLog, LogVerificationStatus, FarmerProfile } from '../../types';
import { verifyLog } from '../../application/usecases/VerifyLog';
import { useDataSource } from '../providers/DataSourceProvider';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { resolveVerifierUserId } from '../../core/domain/verifierIdentity';
import { getSessionUserId } from '../../infrastructure/storage/AuthTokenStore';

export interface UseTrustLayerResult {
    handleVerifyLog: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    handleSwitchOperator: (operatorId: string) => void;
}

interface UseTrustLayerProps {
    farmerProfile: FarmerProfile;
    setFarmerProfile: React.Dispatch<React.SetStateAction<FarmerProfile>>;
    // Unified History Setter
    setHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>;
    /**
     * WAVE-1.4 (spec: dfes-companion-2026-07-11): approval failures must be
     * VISIBLE. Previously a failure was written into the log's farmer-facing
     * `verification.notes` as a raw Zod error and the row quietly reverted —
     * from the farmer's seat the button simply did nothing. Same prop shape
     * as the sibling hooks (`useLogCommands`, `useIssueCommands`).
     */
    setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
    // Deprecated setters — still supplied by `compositionRoot`, never read here.
    setMockHistory?: React.Dispatch<React.SetStateAction<DailyLog[]>>;
    setRealHistory?: React.Dispatch<React.SetStateAction<DailyLog[]>>;
    isDemoMode: boolean; // Kept via props but unused for logic branching now
}

/**
 * Shown when this device holds no server-issued identity at all — not signed
 * in and never synced. Blocking is the honest outcome: the mutation could
 * not be addressed to anyone, so we refuse the tap instead of animating an
 * approval we are about to take back.
 */
const NO_IDENTITY_MESSAGE = 'Cannot approve yet — sign in and sync once, then try again.';
const QUEUE_FAILED_MESSAGE = 'Could not save the approval. Please try again.';
const QUEUED_MESSAGE = 'Approval sent — it will appear once the farm record confirms it.';

export const useTrustLayer = ({
    farmerProfile,
    setFarmerProfile,
    setHistory,
    setToast
}: UseTrustLayerProps): UseTrustLayerResult => {

    const { dataSource, auditPort } = useDataSource();

    /**
     * The device never owns the verification status — the server does. So the
     * only honest rollback is to re-read the durable store, which the
     * optimistic paint never touched.
     */
    const restoreFromStore = useCallback(async () => {
        try {
            setHistory(await dataSource.logs.getAll());
        } catch (error) {
            console.error('Failed to restore log history after a verification failure', error);
        }
    }, [dataSource.logs, setHistory]);

    // --- TRUST LAYER HANDLERS ---
    const handleVerifyLog = useCallback(async (logId: string, status: LogVerificationStatus, notes?: string) => {
        // WAVE-1.4 FIX (I1) — resolve the REAL identity BEFORE anything else.
        // `activeOperatorId` is the literal string 'owner' on a fresh device
        // (see `createInitialFarmerProfile`), and the canonical verify_log_v2
        // contract types `verifierUserId` as a UUID. Sending the placeholder
        // made `mutationQueue.enqueue` throw, which this hook then swallowed
        // into `verification.notes` — the exact silent no-op this task exists
        // to remove. See `core/domain/verifierIdentity.ts`.
        const verifierUserId = resolveVerifierUserId(farmerProfile.activeOperatorId, getSessionUserId());
        if (!verifierUserId) {
            setToast({ message: NO_IDENTITY_MESSAGE, type: 'error' });
            return;
        }

        // Mark as pending while backend mutation is queued and synced.
        setHistory((prev: DailyLog[]) => prev.map(log => {
            if (log.id !== logId) return log;
            return {
                ...log,
                verification: {
                    status,
                    // Local DISPLAY field — resolved against `profile.operators`
                    // for a name, so it stays the operator id, not the wire id.
                    verifiedByOperatorId: farmerProfile.activeOperatorId,
                    notes: notes ? `${notes} (pending sync)` : 'Pending sync',
                    required: true
                }
            };
        }));

        try {
            const result = await verifyLog({
                logId,
                verifierId: verifierUserId,
                action: status === LogVerificationStatus.DISPUTED ? 'dispute' : 'approve',
                note: notes
            }, dataSource.logs, auditPort, farmerProfile);

            if (!result.success) {
                console.error('Verification could not be queued', result.error);
                // Do NOT bury the failure in the farmer-facing `notes` field.
                await restoreFromStore();
                setToast({ message: QUEUE_FAILED_MESSAGE, type: 'error' });
                return;
            }

            setToast({ message: QUEUED_MESSAGE, type: 'success' });
            await backgroundSyncWorker.triggerNow();
            const refreshed = await dataSource.logs.getAll();
            setHistory(refreshed);
        } catch (e) {
            console.error('Verification queue error', e);
            await restoreFromStore();
            setToast({ message: QUEUE_FAILED_MESSAGE, type: 'error' });
        }
    }, [farmerProfile, setHistory, setToast, restoreFromStore, dataSource.logs, auditPort]);

    // --- OPERATOR SESSION HANDLER (DFES Phase 0) ---
    const handleSwitchOperator = useCallback((operatorId: string) => {
        setFarmerProfile(prev => ({
            ...prev,
            activeOperatorId: operatorId
        }));
    }, [setFarmerProfile]);

    return {
        handleVerifyLog,
        handleSwitchOperator
    };
};
