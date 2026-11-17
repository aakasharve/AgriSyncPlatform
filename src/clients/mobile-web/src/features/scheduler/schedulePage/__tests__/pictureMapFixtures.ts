/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150) - the farm the picture-map and three-step-library tests share:
 *   crop 1 (grapes): plots G1, G2 (both follow the university's schedule), G3 (follows nothing);
 *   crop 2 (sugarcane): plot U1 (follows his OWN schedule).
 * Real-shaped: schedules in the server's `ScheduleTemplateDto` shape (mapped by the real `TemplateCatalog`), subscriptions as the phone's Dexie rows.
 */
import type { CropProfile } from '../../../../types';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { REF, SERVER_TEMPLATE, crop, plot } from './scheduleFixtures';

export const FARM = '11111111-1111-4111-8111-111111111111';
export const P = {
    g1: 'aaaaaaaa-0000-4000-8000-000000000001',
    g2: 'aaaaaaaa-0000-4000-8000-000000000002',
    g3: 'aaaaaaaa-0000-4000-8000-000000000003',
    u1: 'aaaaaaaa-0000-4000-8000-000000000004',
} as const;
export const CYCLE = 'cccccccc-0000-4000-8000-000000000001';

export const T = {
    university: '10000000-0000-4000-8000-000000000002',
    expert: '10000000-0000-4000-8000-000000000003',
    ownCane: '10000000-0000-4000-8000-000000000015',
    cane: '10000000-0000-4000-8000-000000000016',
} as const;
export const SUB = { g1: 'dddddddd-0000-4000-8000-0000000000a1', g2: 'dddddddd-0000-4000-8000-0000000000a2', u1: 'dddddddd-0000-4000-8000-0000000000a4' } as const;

const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ ...SERVER_TEMPLATE, id, name, versionHash: 'h', ...extra });

/** What the phone's catalog holds. */
export const TEMPLATES = [
    row(T.university, 'Grapes - University Schedule', { ownerType: 'INSTITUTION', sourceLabel: 'Test University recommendation', check: checkedBy, hasStoredDays: true }),
    row(T.expert, 'Grapes - Expert Schedule', { ownerType: 'EXPERT', sourceLabel: 'Test Expert', check: checkedBy, hasStoredDays: true }),
    row(T.cane, 'Sugarcane - Checked Schedule', { cropType: 'Sugarcane', ownerType: 'INSTITUTION', sourceLabel: 'Test Cane Board', check: checkedBy, hasStoredDays: true }),
    row(T.ownCane, 'Sugarcane - My Own', { cropType: 'Sugarcane', ownerType: 'USER', sourceLabel: 'अशोक पाटील', check: null }),
];

/** The farm: grapes with three plots, sugarcane with one. Grapes carry no crop-wide schedule, so a plot with no choice of its own follows nothing. */
export function farm(): CropProfile[] {
    const grape = (id: string, name: string, start: string) => plot({ id, name, startDate: start, schedule: { ...plot().schedule, id: `sch-${id}`, plotId: id, referenceDate: start } });
    return [
        crop([grape(P.g1, 'G1', REF), grape(P.g2, 'G2', REF), grape(P.g3, 'G3', REF)], { id: 'crop-1', name: 'Grapes', color: 'bg-purple-500', activeScheduleId: null }),
        crop([grape(P.u1, 'U1', REF)], { id: 'crop-2', name: 'Sugarcane', iconName: 'sugarcane', color: 'bg-pink-500', activeScheduleId: null }),
    ];
}

export const subscription = (id: string, plotId: string, templateId: string, extra: Partial<ScheduleSubscriptionRow> = {}): ScheduleSubscriptionRow => ({
    id, farmId: FARM, plotId, cropCycleId: CYCLE, templateId, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-02T00:00:00Z',
    origin: 'Outside', checkState: 'Checked', slot: 1, isMain: true, ...extra,
});

/** G1 and G2 follow the university's schedule; U1 follows his own; G3 follows nothing. */
export async function seedFarmSubscriptions(): Promise<void> {
    const db = getDatabase();
    await db.scheduleSubscriptions.bulkPut([
        subscription(SUB.g1, P.g1, T.university),
        subscription(SUB.g2, P.g2, T.university),
        subscription(SUB.u1, P.u1, T.ownCane, { origin: 'Own', checkState: undefined, slot: 0 }),
    ]);
}
