import { AgriLogResponse } from '../../../types';
import { EditableLogBucketId, VisibleBucketId } from '../../../domain/ai/BucketId';
import { isCompletedIrrigationEvent } from './irrigationCompletion';
import { buildWorkDoneProjection } from './workDoneProjection';

function hasItems<T>(items?: T[] | null): boolean {
    return Array.isArray(items) && items.length > 0;
}

export function deriveEditableBucketsFromParseResult(log: AgriLogResponse): EditableLogBucketId[] {
    const buckets: EditableLogBucketId[] = [];

    if ((log.irrigation || []).some(isCompletedIrrigationEvent)) buckets.push('irrigation');
    if (hasItems(log.inputs)) buckets.push('inputs');
    if (hasItems(log.labour)) buckets.push('labour');
    if (hasItems(log.machinery)) buckets.push('machinery');
    if (hasItems(log.cropActivities)) buckets.push('cropActivities');

    return buckets;
}

export function deriveVisibleBucketsFromParseResult(log: AgriLogResponse): VisibleBucketId[] {
    const buckets: VisibleBucketId[] = [];
    const hasWorkDone = buildWorkDoneProjection(log).length > 0
        || Boolean(log.disturbance)
        || hasItems(log.plannedTasks)
        || hasItems(log.observations);

    if (hasWorkDone) buckets.push('workDone');
    if ((log.irrigation || []).some(isCompletedIrrigationEvent)) buckets.push('irrigation');
    if (hasItems(log.inputs)) buckets.push('inputs');
    if (hasItems(log.labour)) buckets.push('labour');
    if (hasItems(log.machinery)) buckets.push('machinery');
    if (hasItems(log.activityExpenses)) buckets.push('expenses');
    if (hasItems(log.plannedTasks)) buckets.push('tasks');
    if (hasItems(log.observations)) buckets.push('observations');

    return buckets;
}

/**
 * @deprecated Use deriveEditableBucketsFromParseResult for wizard buckets or
 * deriveVisibleBucketsFromParseResult for user-visible bucket badges.
 */
export function deriveBucketsFromParseResult(log: AgriLogResponse): EditableLogBucketId[] {
    return deriveEditableBucketsFromParseResult(log);
}
