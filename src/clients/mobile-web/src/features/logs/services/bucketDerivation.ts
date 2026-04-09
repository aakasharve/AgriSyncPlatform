import { AgriLogResponse } from '../../../types';

export function deriveBucketsFromParseResult(log: AgriLogResponse): string[] {
    const buckets: string[] = [];

    if (log.irrigation && log.irrigation.length > 0) buckets.push('irrigation');
    if (log.inputs && log.inputs.length > 0) buckets.push('inputs');
    if (log.labour && log.labour.length > 0) buckets.push('labour');
    if (log.machinery && log.machinery.length > 0) buckets.push('machinery');
    if (log.cropActivities && log.cropActivities.length > 0) buckets.push('crop_activity');

    return buckets;
}
