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

/**
 * KNOWN GAP (plr-d10 I15, inventory S16 part 1 — left as is on purpose): no server route answers this path.
 * It was written for the adoptable model (`CropScheduleTemplate`, ssf.crop_schedule_templates: templateKey,
 * versionTag, tolerance days), which `AdoptScheduleHandler` looks ids up in. The server lists only the OTHER
 * model at `/shramsafal/reference/schedule-templates` (`ScheduleTemplate` rows / ReferenceDataCatalog GUIDs);
 * pointing the picker there would list schedules whose adopt always fails (ScheduleTemplateNotFound), a
 * button that never works (doctrine P5). The right fix needs a server list over the adoptable model, or
 * PLR-D8 decision D (which model is "the library"). Today the picker that calls this is never shown
 * (QuickLogSheet gets no plot/cycle/farm), and the library the farmer sees reads the synced catalog instead.
 */
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
