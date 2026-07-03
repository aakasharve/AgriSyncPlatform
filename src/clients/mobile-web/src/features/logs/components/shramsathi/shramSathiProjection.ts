import { DailyLog } from '../../../../domain/types/log.types';
import { ShramSathiGap } from './ShramSathiMeter';

export interface ShramSathiProjection {
    score: { value: number };
    arrived: boolean;
    arrivingProgress: number;
    gaps: ShramSathiGap[];
}

function hasItems<T>(items: readonly T[] | undefined): boolean {
    return Array.isArray(items) && items.length > 0;
}

function estimateUnderstandingScore(log: DailyLog): number {
    const covered = [
        hasItems(log.cropActivities),
        hasItems(log.irrigation),
        hasItems(log.labour),
        hasItems(log.inputs),
        hasItems(log.machinery),
        hasItems(log.activityExpenses),
        hasItems(log.observations),
        Boolean(log.disturbance),
    ].filter(Boolean).length;

    const transcriptBonus = Math.min(1.5, (log.fullTranscript?.trim().length ?? 0) / 160);
    const score = 2.8 + covered * 1.05 + transcriptBonus;

    return Math.min(10, Math.max(1, score));
}

function buildGaps(log: DailyLog | undefined): ShramSathiGap[] {
    if (!log) return [];

    const gaps: ShramSathiGap[] = [];
    if (!hasItems(log.irrigation)) {
        gaps.push({ id: 'irrigation', question: 'किती पाण्यात किंवा किती वेळ पाणी दिलं?' });
    }
    if (!hasItems(log.inputs)) {
        gaps.push({ id: 'inputs', question: 'कुठलं औषध किंवा खत दिलंत?' });
    }
    if (!hasItems(log.labour)) {
        gaps.push({ id: 'labour', question: 'रोजगार किती होता?' });
    }
    if (!hasItems(log.activityExpenses) && !hasItems(log.machinery)) {
        gaps.push({ id: 'cost', question: 'डिझेल किंवा इतर खर्च किती लागला?' });
    }

    return gaps;
}

export function buildShramSathiProjection(savedLogs: DailyLog[], allLogs: DailyLog[]): ShramSathiProjection {
    const visibleLogs = savedLogs.length > 0 ? savedLogs : allLogs.slice(-1);
    const scoreValue = visibleLogs.length === 0
        ? 0
        : visibleLogs.reduce((sum, log) => sum + estimateUnderstandingScore(log), 0) / visibleLogs.length;

    const richLogs = allLogs.filter(log => estimateUnderstandingScore(log) > 5).length;

    return {
        score: { value: scoreValue },
        arrived: richLogs >= 20,
        arrivingProgress: Math.min(20, richLogs),
        gaps: buildGaps(visibleLogs[0]),
    };
}
