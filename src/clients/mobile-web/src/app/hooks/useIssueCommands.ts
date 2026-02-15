
import { useCallback } from 'react';
import { BucketIssue } from '../../domain/types/log.types';
import { FarmerProfile } from '../../domain/types/farm.types';
import { addIssueToLog } from '../../application/usecases/AddIssueToLog';
import { logger } from '../../infrastructure/observability/Logger';
import { CorrelationId } from '../../infrastructure/observability/CorrelationContext';
import { useDataSource } from '../providers/DataSourceProvider';

interface UseIssueCommandsProps {
    farmerProfile: FarmerProfile;
    // Unified History Setter
    setHistory: React.Dispatch<React.SetStateAction<any[]>>;
    // Deprecated setter
    setRealHistory?: any;
    setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

export const useIssueCommands = ({ farmerProfile, setHistory, setToast }: UseIssueCommandsProps) => {

    const { dataSource, auditPort } = useDataSource();

    const handleAddIssue = useCallback(async (logId: string, eventId: string, issue: BucketIssue) => {
        const correlationId = CorrelationId.generate();
        logger.info('Add Issue started', { correlationId, logId, eventId, issueType: issue.issueType });

        try {
            const repo = dataSource.logs;
            const result = await addIssueToLog({
                logId,
                targetEventId: eventId,
                issue,
                actorId: farmerProfile.activeOperatorId || 'unknown',
                reason: issue.reason
            }, repo, auditPort, farmerProfile);

            if (result.success && result.log) {
                // Update local state
                setHistory(prev => prev.map(l => l.id === logId ? result.log : l));
                setToast({ message: 'Issue added successfully', type: 'success' });
                logger.info('Add Issue completed', { correlationId });
            } else {
                throw new Error(result.error);
            }
        } catch (e) {
            logger.error('Add Issue failed', e, { correlationId });
            setToast({ message: 'Failed to add issue', type: 'error' });
        }
    }, [farmerProfile, setHistory, setToast, dataSource.logs, auditPort]);

    return {
        handleAddIssue
    };
};
