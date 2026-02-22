import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase, type ReferenceDataKey } from '../../infrastructure/storage/DexieDatabase';

export interface StageDefinitionDto {
    name: string;
    startDay: number;
    endDay: number;
}

export interface TemplateActivityDto {
    name: string;
    category: string;
    stageName: string;
    startDay: number;
    endDay: number;
    frequencyMode: string;
    intervalDays?: number | null;
}

export interface ScheduleTemplateDto {
    id: string;
    name: string;
    cropType: string;
    totalDays: number;
    stages: StageDefinitionDto[];
    activities: TemplateActivityDto[];
    versionHash: string;
}

export interface CropTypeDto {
    name: string;
    stages: string[];
    defaultTemplateId?: string | null;
}

function useReferenceDataValue<T>(key: ReferenceDataKey): T | null {
    const [value, setValue] = useState<T | null>(null);

    useEffect(() => {
        let active = true;
        const db = getDatabase();

        const subscription = liveQuery(() => db.referenceData.get(key)).subscribe({
            next: record => {
                if (!active) {
                    return;
                }

                setValue((record?.data as T | undefined) ?? null);
            },
            error: () => {
                if (!active) {
                    return;
                }

                setValue(null);
            },
        });

        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, [key]);

    return value;
}

export function useScheduleTemplates(): ScheduleTemplateDto[] | null {
    return useReferenceDataValue<ScheduleTemplateDto[]>('scheduleTemplates');
}

export function useCropTypes(): CropTypeDto[] | null {
    return useReferenceDataValue<CropTypeDto[]>('cropTypes');
}

export function useActivityCategories(): string[] | null {
    return useReferenceDataValue<string[]>('activityCategories');
}

export function useCostCategories(): string[] | null {
    return useReferenceDataValue<string[]>('costCategories');
}
