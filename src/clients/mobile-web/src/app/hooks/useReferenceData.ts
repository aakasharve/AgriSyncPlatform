import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase, type ReferenceDataKey } from '../../infrastructure/storage/DexieDatabase';
import {
    DEFAULT_COST_CATEGORIES,
    type CostCategoryRef,
} from '../../domain/finance/CostCategory';

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

/**
 * Returns the canonical `CostCategoryRef[]` from Dexie's
 * `referenceData/costCategories` row. Before the first Sync-Pull
 * (or while the row is being rewritten) we surface the 13-entry
 * `DEFAULT_COST_CATEGORIES` fallback so dropdowns / labels render
 * Marathi-first labels immediately on a cold start.
 *
 * DATA_PRINCIPLE_SPINE 02.5 — wire-shape change: server now emits
 * `CostCategoryRef[]` (id + mr/hi/en) instead of `string[]`.
 */
export function useCostCategories(): CostCategoryRef[] {
    const value = useReferenceDataValue<CostCategoryRef[]>('costCategories');
    return value && value.length > 0
        ? value
        : (DEFAULT_COST_CATEGORIES as CostCategoryRef[]);
}
