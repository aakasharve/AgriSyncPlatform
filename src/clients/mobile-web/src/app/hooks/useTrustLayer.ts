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
    // Deprecated setters (kept on the prop bag for backward compatibility)
    setMockHistory?: React.Dispatch<React.SetStateAction<DailyLog[]>>;
    setRealHistory?: React.Dispatch<React.SetStateAction<DailyLog[]>>;
    isDemoMode: boolean; // Kept via props but unused for logic branching now
}

export const useTrustLayer = ({
    farmerProfile,
    setFarmerProfile,
    setHistory,
}: UseTrustLayerProps): UseTrustLayerResult => {

    const { dataSource, auditPort } = useDataSource();

    // --- TRUST LAYER HANDLERS ---
    const handleVerifyLog = useCallback(async (logId: string, status: LogVerificationStatus, notes?: string) => {
        // Mark as pending while backend mutation is queued and synced.
        setHistory((prev: DailyLog[]) => prev.map(log => {
            if (log.id !== logId) return log;
            return {
                ...log,
                verification: {
                    status,
                    verifiedByOperatorId: farmerProfile.activeOperatorId,
                    notes: notes ? `${notes} (pending sync)` : 'Pending sync',
                    required: true
                }
            };
        }));

        try {
            const result = await verifyLog({
                logId,
                verifierId: farmerProfile.activeOperatorId || 'unknown',
                action: status === LogVerificationStatus.DISPUTED ? 'dispute' : 'approve',
                note: notes
            }, dataSource.logs, auditPort, farmerProfile);

            if (!result.success) {
                setHistory((prev: DailyLog[]) => prev.map(log => {
                    if (log.id !== logId) return log;
                    return {
                        ...log,
                        verification: {
                            status: log.verification?.status ?? LogVerificationStatus.DRAFT,
                            verifiedByOperatorId: log.verification?.verifiedByOperatorId,
                            verifiedAtISO: log.verification?.verifiedAtISO,
                            notes: result.error || 'Verification failed',
                            required: true
                        }
                    };
                }));
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
