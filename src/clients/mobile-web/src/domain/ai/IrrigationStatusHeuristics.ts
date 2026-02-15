import type { BucketIssueType, IrrigationEvent } from '../types/log.types';

const IRRIGATION_KEYWORDS = [
    /पाणी/u,
    /सिंचन/u,
    /irrigat/i,
    /\bwater(ed|ing)?\b/i,
    /\bpaani\b/i,
    /\bpani\b/i,
    /\bsinchai\b/i,
    /\bsinchan\b/i
];

const FAILURE_MARKERS = [
    /देता\s*आल[ेो]\s*नाही/u,
    /दिल[ें]\s*नाही/u,
    /झाल[ेो]\s*नाही/u,
    /नहीं/u,
    /\bnahi\b/i,
    /could\s*not/i,
    /couldn['’]?t/i,
    /did\s*not/i,
    /didn['’]?t/i,
    /unable\s*to/i,
    /not\s*done/i,
    /failed/i
];

const COMBINED_FAILURE_PATTERNS = [
    /पाणी\s*देता\s*आल[ेो]\s*नाही/u,
    /पाणी\s*दिल[ें]\s*नाही/u,
    /सिंचन\s*झाल[ेो]\s*नाही/u,
    /पानी\s*नहीं\s*दिया/u,
    /पानी\s*नहीं\s*दे/u,
    /could\s*not\s*(irrigate|water)/i,
    /didn['’]?t\s*(irrigate|water)/i,
    /no\s*irrigation/i,
    /irrigation\s*(not\s*done|failed)/i,
    /\bpani\s*nahi\s*(diya|de|de\s*paye)\b/i
];

const MOTOR_PATTERNS = [/मोटर/u, /pump/i, /पंप/u, /\bmotor\b/i, /प्रॉब्लेम/u, /problem/i, /खराब/u];
const POWER_PATTERNS = [/वीज/u, /\blight\b/i, /electric/i, /\bpower\b/i, /phase/i, /बिजली/u];
const WATER_SOURCE_PATTERNS = [/water\s*shortage/i, /source\s*dry/i, /dry\s*(well|bore)/i, /पाणी\s*नाही/u, /कोरड/u];

const normalizeText = (text: string): string =>
    (text || '').toLowerCase().replace(/\s+/g, ' ').trim();

const hasAny = (text: string, patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(text));

export function detectIrrigationFailureFromText(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    if (hasAny(normalized, COMBINED_FAILURE_PATTERNS)) return true;
    const hasIrrigation = hasAny(normalized, IRRIGATION_KEYWORDS);
    const hasFailure = hasAny(normalized, FAILURE_MARKERS);
    return hasIrrigation && hasFailure;
}

export function inferIrrigationIssueTypeFromText(text: string): BucketIssueType {
    const normalized = normalizeText(text);
    if (hasAny(normalized, MOTOR_PATTERNS)) return 'MACHINERY';
    if (hasAny(normalized, POWER_PATTERNS)) return 'ELECTRICITY';
    if (hasAny(normalized, WATER_SOURCE_PATTERNS)) return 'WATER_SOURCE';
    return 'OTHER';
}

export function inferIrrigationIssueReasonFromText(text: string): string {
    const type = inferIrrigationIssueTypeFromText(text);
    if (type === 'MACHINERY') return 'Motor/Pump issue blocked irrigation';
    if (type === 'ELECTRICITY') return 'Power unavailable for irrigation';
    if (type === 'WATER_SOURCE') return 'Water source unavailable for irrigation';
    return 'Irrigation could not be completed';
}

export function isFailedIrrigationEvent(event: IrrigationEvent, transcriptText?: string): boolean {
    const issueType = event.issue?.issueType;
    const hasBlockingIssue = issueType === 'MACHINERY'
        || issueType === 'ELECTRICITY'
        || issueType === 'WATER_SOURCE'
        || issueType === 'OTHER';

    const duration = typeof event.durationHours === 'number' ? event.durationHours : undefined;
    const hasZeroDuration = duration !== undefined && duration <= 0;

    const eventText = [
        event.notes || '',
        event.sourceText || '',
        event.systemInterpretation || '',
        event.issue?.reason || '',
        event.issue?.note || '',
        transcriptText || ''
    ].join(' ');

    const hasFailureText = detectIrrigationFailureFromText(eventText);
    return hasFailureText || (hasBlockingIssue && hasZeroDuration);
}

export function countSuccessfulIrrigationEvents(events: IrrigationEvent[] = [], transcriptText?: string): number {
    return events.filter(event => !isFailedIrrigationEvent(event, transcriptText)).length;
}

export function hasSuccessfulIrrigation(events: IrrigationEvent[] = [], transcriptText?: string): boolean {
    return countSuccessfulIrrigationEvents(events, transcriptText) > 0;
}
