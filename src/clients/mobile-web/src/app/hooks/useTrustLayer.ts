import { useCallback } from 'react';
import { DailyLog, LogVerificationStatus, FarmerProfile } from '../../types';
import { verifyLog } from '../../application/usecases/VerifyLog';
import { useDataSource } from '../providers/DataSourceProvider';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';

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
     * Deprecated setters. `compositionRoot.ts` still passes both; nothing in
     * this hook reads either. Typed `unknown` rather than `any` so the
     * pre-commit ESLint gate (`--max-warnings 0`) passes on this file — the
     * accepted-and-ignored contract is unchanged, since `unknown` accepts
     * every argument shape `any` did at the call site.
     */
    setMockHistory?: unknown;
    setRealHistory?: unknown;
    isDemoMode: boolean; // Kept via props but unused for logic branching now
}

export const useTrustLayer = ({
    farmerProfile,
    setFarmerProfile,
    setHistory
    // `isDemoMode` is accepted (see the props interface) and deliberately
    // not destructured — no branch in this hook has read it since the
    // history setters were unified.
}: UseTrustLayerProps): UseTrustLayerResult => {

    const { dataSource, auditPort } = useDataSource();

    // --- TRUST LAYER HANDLERS ---
    /**
     * NO OPTIMISTIC SUCCESS — spec §P-D, "Acknowledgement never fakes
     * success. The tick confirms only after the write succeeds."
     *
     * What used to stand at the top of this function was a `setHistory`
     * that wrote the CALLER'S TARGET STATUS into the log before anything
     * had been queued, let alone acknowledged. Approving passed
     * `LogVerificationStatus.APPROVED`, which `shared/utils/dayState.ts`'s
     * `VERIFIED_STATUSES` set counts as verified — so the row rendered as
     * approved and simultaneously dropped out of every unverified count
     * (`isLogUnverified` -> `computeDayState` -> the waiting drawer's
     * `unverifiedCount`), all from a local write nothing had confirmed.
     * The `notes: 'Pending sync'` beside it did not save it: `notes` is not
     * what any of those readers look at, and `status` is.
     *
     * That would be wrong even against a working server. Against THIS
     * server it was a straight falsehood: the mutation those approvals
     * queued is `verify_log_v2`, whose handler answers
     * `MUTATION_TYPE_UNIMPLEMENTED` (`PushSyncBatchHandler.cs`), so the
     * push was refused every time while the farmer was shown a tick.
     *
     * The failure branch's `setHistory` is gone for the same reason,
     * inverted: it wrote `required: true` and an error string into the
     * log's `verification` object, i.e. it edited a record to describe the
     * health of a queue. This hook now writes exactly one thing into
     * history — `dataSource.logs.getAll()`, the durable store's own answer,
     * read back AFTER the sync attempt. Whatever it says is what the UI
     * says, and nothing is asserted in between.
     *
     * REACHABILITY, stated plainly: no farmer-facing surface calls this any
     * more. `ReviewInboxSheet` and `ReviewInbox` both lost their approve
     * and dispute controls (see either file's header), so the only caller
     * left is `pages/TestE2EPage.tsx`, which is build-time gated behind
     * `VITE_E2E_HARNESS=1` and absent from production bundles. This
     * function is kept, and kept honest, because the underlying use case is
     * coming back once the server side exists — not because it is live.
     *
     * STILL BROKEN, DELIBERATELY NOT FIXED HERE: `verifyLog()` returns
     * `success: true` on ENQUEUE, not on server acknowledgement (see
     * `application/usecases/VerifyLog.ts`). Making that honest needs an
     * ack-await path that does not exist yet. It matters much less now that
     * nothing renders a claim off this result — but it must be fixed before
     * any UI calls this again.
     */
    const handleVerifyLog = useCallback(async (logId: string, status: LogVerificationStatus, notes?: string) => {
        try {
            const result = await verifyLog({
                logId,
                verifierId: farmerProfile.activeOperatorId || 'unknown',
                action: status === LogVerificationStatus.DISPUTED ? 'dispute' : 'approve',
                note: notes
            }, dataSource.logs, auditPort, farmerProfile);

            if (!result.success) {
                console.error('Verification could not be queued', result.error);
                return;
            }

            await backgroundSyncWorker.triggerNow();
            const refreshed = await dataSource.logs.getAll();
            setHistory(refreshed);
        } catch (e) {
            console.error('Verification queue error', e);
        }
    }, [farmerProfile, setHistory, dataSource.logs, auditPort]);

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
