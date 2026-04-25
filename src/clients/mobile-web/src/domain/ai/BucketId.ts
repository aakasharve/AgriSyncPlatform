export const VISIBLE_BUCKET_IDS = [
    'workDone',
    'irrigation',
    'inputs',
    'labour',
    'machinery',
    'expenses',
    'tasks',
    'observations',
] as const;

export type VisibleBucketId = typeof VISIBLE_BUCKET_IDS[number];

export const EDITABLE_LOG_BUCKET_IDS = [
    'cropActivities',
    'irrigation',
    'inputs',
    'labour',
    'machinery',
] as const;

export type EditableLogBucketId = typeof EDITABLE_LOG_BUCKET_IDS[number];

export type LegacyLogSegmentId = 'crop_activity' | 'irrigation' | 'labour' | 'input' | 'machinery';

export const visibleBucketLabels: Record<VisibleBucketId, string> = {
    workDone: 'Work Done',
    irrigation: 'Irrigation',
    inputs: 'Inputs',
    labour: 'Labour',
    machinery: 'Machinery',
    expenses: 'Expenses',
    tasks: 'Tasks',
    observations: 'Observations',
};

export function normalizeLegacyLogSegmentId(segment: LegacyLogSegmentId): EditableLogBucketId {
    switch (segment) {
        case 'crop_activity':
            return 'cropActivities';
        case 'input':
            return 'inputs';
        default:
            return segment;
    }
}

export function toLegacyLogSegmentId(bucket: EditableLogBucketId): LegacyLogSegmentId {
    switch (bucket) {
        case 'cropActivities':
            return 'crop_activity';
        case 'inputs':
            return 'input';
        default:
            return bucket;
    }
}

export function inferVisibleBucketIdFromFieldPath(fieldPath: string): VisibleBucketId | undefined {
    const root = fieldPath.trim().split(/[.[\]]/, 1)[0];

    switch (root) {
        case 'cropActivities':
            return 'workDone';
        case 'irrigation':
        case 'inputs':
        case 'labour':
        case 'machinery':
        case 'observations':
            return root;
        case 'activityExpenses':
            return 'expenses';
        case 'plannedTasks':
        case 'tasks':
            return 'tasks';
        default:
            return undefined;
    }
}
