// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// Pure helpers used by AppRouter and its route render functions. No hooks, no JSX.

import { DailyLog, LogVerificationStatus } from '../../types';

export type FeedStatusTone = 'pending' | 'rejected' | 'approved';

export const formatLogTime = (iso?: string): string => {
    if (!iso) return '--:--';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

export const truncateLine = (value: string, maxLength: number = 72): string => {
    if (!value) return value;
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}...`;
};

export const getVerificationPresentation = (status?: LogVerificationStatus): {
    label: 'UNVERIFIED' | 'VERIFIED';
    tone: FeedStatusTone;
    isPending: boolean;
} => {
    const verified = status === LogVerificationStatus.VERIFIED || status === LogVerificationStatus.APPROVED;
    if (verified) {
        return { label: 'VERIFIED', tone: 'approved', isPending: false };
    }
    return { label: 'UNVERIFIED', tone: 'pending', isPending: true };
};

export const getPrimaryWorkDone = (log: DailyLog): string => {
    if (log.disturbance?.reason) {
        return `Work Blocked: ${log.disturbance.reason}`;
    }

    const primaryActivity = log.cropActivities?.[0];
    const candidateTitle = primaryActivity?.title?.trim();
    const workType = primaryActivity?.workTypes?.[0]?.trim();
    if (workType) return `${workType} Completed`;
    if (candidateTitle && candidateTitle.toLowerCase() !== 'daily operations') return `${candidateTitle} Completed`;

    if (log.irrigation.length > 0) return 'Irrigation Completed';

    const primaryInput = log.inputs?.[0];
    if (primaryInput) {
        const isFertilizer = primaryInput.type === 'fertilizer' || primaryInput.reason === 'Growth' || primaryInput.reason === 'Deficiency';
        const isSpray = primaryInput.type === 'pesticide' || primaryInput.type === 'fungicide' || primaryInput.reason === 'Pest' || primaryInput.reason === 'Disease';
        if (isFertilizer) return 'Fertilizer Applied';
        if (isSpray) return 'Spray Logged';
        return 'Input Applied';
    }

    const primaryLabour = log.labour?.[0];
    if (primaryLabour?.activity) return `${primaryLabour.activity} Done`;
    if (log.labour.length > 0) return 'Labour Logged';

    if (log.machinery.length > 0) return 'Machinery Work Logged';
    return 'Activity Logged';
};

export const getSummaryLines = (log: DailyLog): string[] => {
    const lines: string[] = [];

    const irrigation = log.irrigation?.[0];
    if (irrigation) {
        if (typeof irrigation.durationHours === 'number') {
            lines.push(`Water Duration: ${irrigation.durationHours} hrs`);
        }
        if (irrigation.method || irrigation.source) {
            lines.push(`${irrigation.method || 'Irrigation'} via ${irrigation.source || 'available source'}`);
        }
    }

    const input = log.inputs?.[0];
    if (input && lines.length < 2) {
        const firstMix = input.mix?.[0]?.productName || input.productName;
        if (firstMix) {
            lines.push(`Input: ${firstMix}`);
        }
    }

    const labour = log.labour?.[0];
    if (labour && lines.length < 2 && labour.count) {
        lines.push(`Labour: ${labour.count} workers`);
    }

    const firstObservation = log.observations?.[0]?.textCleaned || log.observations?.[0]?.textRaw;
    const firstActivityNote = log.cropActivities.find(activity => activity.notes)?.notes;
    const firstIrrigationNote = log.irrigation.find(event => event.notes)?.notes;
    const firstNote = firstObservation || firstActivityNote || firstIrrigationNote;
    if (firstNote && lines.length < 2) {
        lines.push(`Note: ${truncateLine(firstNote, 60)}`);
    }

    lines.push(
        `System: ${log.cropActivities.length} activity, ${log.irrigation.length} irrigation, ${log.inputs.length} input entries.`
    );

    return lines.slice(0, 3).map(line => truncateLine(line));
};
