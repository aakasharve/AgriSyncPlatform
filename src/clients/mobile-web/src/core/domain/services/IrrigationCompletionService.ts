import type { IrrigationEvent } from '../../../types';

const BLOCKED_IRRIGATION_TEXT =
    /(could not|unable|failed|blocked|not done|did not|deta ale nahi|pani deta ale nahi|देता आले नाही|पाणी देता आले नाही|झाले नाही|नाही झाले|खराब|बंद|band|kharab)/i;

function positive(value?: number | null): boolean {
    return typeof value === 'number' && value > 0;
}

function textFor(event: IrrigationEvent): string {
    return [
        event.notes,
        event.sourceText,
        event.systemInterpretation,
        event.issue?.reason,
        event.issue?.note,
        event.issue?.sourceText,
        event.issue?.systemInterpretation,
    ].filter(Boolean).join(' ');
}

export function hasMeasuredWaterDelivery(event: IrrigationEvent): boolean {
    return positive(event.durationHours) || positive(event.waterVolumeLitres);
}

export function isIssueOnlyIrrigation(event: IrrigationEvent): boolean {
    if (hasMeasuredWaterDelivery(event)) return false;
    if (event.id?.startsWith('irr_blocked_')) return true;
    if (event.issue) return true;
    return BLOCKED_IRRIGATION_TEXT.test(textFor(event));
}

export function isCompletedIrrigationEvent(event: IrrigationEvent): boolean {
    if (isIssueOnlyIrrigation(event)) return false;
    if (hasMeasuredWaterDelivery(event)) return true;
    return Boolean(event.method || event.source || event.sourceText);
}

export function countCompletedIrrigationEvents(events: IrrigationEvent[] | undefined | null): number {
    return (events || []).filter(isCompletedIrrigationEvent).length;
}
