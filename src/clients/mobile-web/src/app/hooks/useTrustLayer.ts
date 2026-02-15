import { useCallback } from 'react';
import { DailyLog, LogVerificationStatus, FarmerProfile } from '../../types';
import { verifyLog } from '../../application/usecases/VerifyLog';
import { useDataSource } from '../providers/DataSourceProvider';

export interface UseTrustLayerResult {
    handleVerifyLog: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    handleSwitchOperator: (operatorId: string) => void;
}

interface UseTrustLayerProps {
    farmerProfile: FarmerProfile;
    setFarmerProfile: React.Dispatch<React.SetStateAction<FarmerProfile>>;
    // Unified History Setter
    setHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>;
    // Deprecated setters
    setMockHistory?: any;
    setRealHistory?: any;
    isDemoMode: boolean; // Kept via props but unused for logic branching now
}

export const useTrustLayer = ({
    farmerProfile,
    setFarmerProfile,
    setHistory,
    isDemoMode
}: UseTrustLayerProps): UseTrustLayerResult => {

    const { dataSource, auditPort } = useDataSource();

    // --- TRUST LAYER HANDLERS ---
    const handleVerifyLog = useCallback(async (logId: string, status: LogVerificationStatus, notes?: string) => {
        // 1. Optimistic UI Update (keep UI responsive)
        const updater = (prev: DailyLog[]) => prev.map(log => {
            if (log.id !== logId) return log;
            return {
                ...log,
                verification: {
                    ...log.verification,
                    status: status,
                    verifiedByOperatorId: farmerProfile.activeOperatorId,
                    verifiedAtISO: new Date().toISOString(),
                    notes: notes,
                    required: true
                }
            };
        });

        // Update React State immediately
        setHistory(updater);

        // 2. Persistent Write via Use-Case (with Audit & Policy)
        // Works for both Demo (LocalStorage) and Real (Dexie) via DataSource abstraction
        try {
            const result = await verifyLog({
                logId,
                verifierId: farmerProfile.activeOperatorId || 'unknown',
                action: status === LogVerificationStatus.DISPUTED ? 'dispute' : 'approve',
                note: notes
            }, dataSource.logs, auditPort, farmerProfile);

            if (!result.success) {
                console.error("Verification failed:", result.error);
                // Rollback (revert optimistic update)
                // This would require fetching usage-case or undo logic
                // For now, we alert.
                alert(`Verification failed: ${result.error}`);
            }
        } catch (e) {
            console.error("Verification System Error", e);
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
