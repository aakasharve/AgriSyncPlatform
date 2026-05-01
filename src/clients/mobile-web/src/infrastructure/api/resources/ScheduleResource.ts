// Sub-plan 04 Task 9: AgriSyncClient decomposition — schedule surface.
// Behavior identical to original.

import type {
    AbandonScheduleRequest,
    AdoptScheduleRequest,
    CropScheduleTemplateDto,
    MigrateScheduleRequest,
    ScheduleSubscriptionDto,
} from '../dtos';
import type { HttpTransport } from '../transport';

export async function getCropScheduleTemplates(
    t: HttpTransport,
    cropKey: string,
): Promise<CropScheduleTemplateDto[]> {
    const response = await t.http.get<CropScheduleTemplateDto[]>(
        `/shramsafal/reference-data/crop-schedule-templates`,
        { params: { cropKey } },
    );
    return response.data;
}

export async function adoptSchedule(
    t: HttpTransport,
    plotId: string,
    cycleId: string,
    body: AdoptScheduleRequest,
): Promise<ScheduleSubscriptionDto> {
    const response = await t.http.post<ScheduleSubscriptionDto>(
        `/shramsafal/plots/${plotId}/cycles/${cycleId}/schedule/adopt`,
        body,
    );
    return response.data;
}

export async function migrateSchedule(
    t: HttpTransport,
    plotId: string,
    cycleId: string,
    body: MigrateScheduleRequest,
): Promise<ScheduleSubscriptionDto> {
    const response = await t.http.post<ScheduleSubscriptionDto>(
        `/shramsafal/plots/${plotId}/cycles/${cycleId}/schedule/migrate`,
        body,
    );
    return response.data;
}

export async function abandonSchedule(
    t: HttpTransport,
    plotId: string,
    cycleId: string,
    body: AbandonScheduleRequest,
): Promise<ScheduleSubscriptionDto> {
    const response = await t.http.post<ScheduleSubscriptionDto>(
        `/shramsafal/plots/${plotId}/cycles/${cycleId}/schedule/abandon`,
        body,
    );
    return response.data;
}
