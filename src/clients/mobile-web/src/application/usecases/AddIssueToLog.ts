
import { DailyLog, BucketIssue } from '../../domain/types/log.types';
import { LogsRepository } from '../ports';
import { AuditPort } from '../ports/AuditPort';
import { FarmerProfile } from '../../domain/types/farm.types';
import { updateLog } from './UpdateLog';

interface AddIssueRequest {
    logId: string;
    targetEventId: string; // The ID of the activity/labour/etc.
    issue: BucketIssue;
    actorId: string;
    reason: string;
}

interface AddIssueResult {
    success: boolean;
    log?: DailyLog;
    error?: string;
}

/**
 * AddIssueToLog
 *
 * Appends a BucketIssue to a specific event within a log.
 * Uses UpdateLog internally to ensure:
 * 1. Verification status is reset (if verified)
 * 2. Patch history is preserved
 * 3. Audit trail is recorded
 */
export const addIssueToLog = async (
    request: AddIssueRequest,
    repo: LogsRepository,
    auditPort: AuditPort,
    _profile: FarmerProfile
): Promise<AddIssueResult> => {
    // 1. Fetch Log
    const log = await repo.getById(request.logId);
    if (!log) {
        return { success: false, error: 'Log not found' };
    }

    // 2. Find and Update Target Event
    let eventFound = false;
    let categoryFound = '';

    // Helper to inject issue. The buckets injected through this helper share
    // the {id, issue?} shape needed here; a generic constraint preserves the
    // element type at each call site.
    const injectIssue = <T extends { id: string; issue?: BucketIssue }>(collection: T[]): T[] => {
        return collection.map(item => {
            if (item.id === request.targetEventId) {
                eventFound = true;
                return { ...item, issue: request.issue };
            }
            return item;
        });
    };

    // Try each bucket
    const updatedActivities = injectIssue(log.cropActivities);
    if (eventFound) categoryFound = 'cropActivities';

    let updatedLabour = log.labour;
    if (!eventFound) {
        updatedLabour = injectIssue(log.labour);
        if (eventFound) categoryFound = 'labour';
    }

    let updatedIrrigation = log.irrigation;
    if (!eventFound) {
        updatedIrrigation = injectIssue(log.irrigation);
        if (eventFound) categoryFound = 'irrigation';
    }

    let updatedInputs = log.inputs;
    if (!eventFound) {
        updatedInputs = injectIssue(log.inputs);
        if (eventFound) categoryFound = 'inputs';
    }

    let updatedMachinery = log.machinery;
    if (!eventFound) {
        updatedMachinery = injectIssue(log.machinery);
        if (eventFound) categoryFound = 'machinery';
    }

    if (!eventFound) {
        return { success: false, error: 'Target event ID not found in log' };
    }

    // 3. Construct Updated Log Object
    const updatedLog: DailyLog = {
        ...log,
        cropActivities: eventFound && categoryFound === 'cropActivities' ? updatedActivities : log.cropActivities,
        labour: eventFound && categoryFound === 'labour' ? updatedLabour : log.labour,
        irrigation: eventFound && categoryFound === 'irrigation' ? updatedIrrigation : log.irrigation,
        inputs: eventFound && categoryFound === 'inputs' ? updatedInputs : log.inputs,
        machinery: eventFound && categoryFound === 'machinery' ? updatedMachinery : log.machinery
    };

    // 4. Save via UpdateLog (handles versioning + audit fields)
    const result = await updateLog({
        logId: request.logId,
        updatedData: updatedLog,
        actorId: request.actorId,
        reason: `Added Issue: ${request.issue.issueType} - ${request.reason}`
    }, repo, _profile);

    // 5. Append issue-specific audit record (boundary via AuditPort)
    if (result.success) {
        await auditPort.append({
            actorId: request.actorId,
            action: 'CORRECT_LOG',
            resourceId: request.logId,
            details: `Issue added to ${categoryFound}: ${request.issue.issueType}`
        });
    }

    return result;
};
