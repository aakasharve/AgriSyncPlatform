import type {
    Farm,
    FarmId,
    PlotAreaRecord,
    PlotId,
} from '../../domain/farmGeography/types';
import type { FarmGeographyRepository } from '../../application/ports/FarmGeographyPort';
import { getDatabase } from '../storage/DexieDatabase';

export class DexieFarmGeographyRepository implements FarmGeographyRepository {
    async getFarm(farmId: FarmId): Promise<Farm | null> {
        const record = await getDatabase().farms.get(farmId);
        return (record?.payload as Farm | undefined) ?? null;
    }

    async listAccessibleFarms(): Promise<Farm[]> {
        const records = await getDatabase().farms.toArray();
        return records
            .map(record => record.payload as Farm | null)
            .filter((farm): farm is Farm => farm !== null && typeof farm === 'object');
    }

    async saveFarm(farm: Farm): Promise<void> {
        await getDatabase().farms.put({
            id: farm.id,
            ownerAccountId: farm.ownerAccountId,
            payload: farm,
            syncStatus: farm.syncStatus,
            serverUpdatedAt: farm.serverUpdatedAt,
            updatedAt: farm.updatedAt,
            modifiedAtUtc: farm.updatedAt,
        });
    }

    async getPlotArea(plotId: PlotId): Promise<PlotAreaRecord | null> {
        const record = await getDatabase().plotAreas.get(plotId);
        return (record?.payload as PlotAreaRecord | undefined) ?? null;
    }

    async savePlotArea(record: PlotAreaRecord): Promise<void> {
        await getDatabase().plotAreas.put({
            id: record.plotId,
            plotId: record.plotId,
            farmId: record.farmId,
            ownerAccountId: record.ownerAccountId,
            payload: record,
            syncStatus: record.syncStatus,
            serverUpdatedAt: record.serverUpdatedAt,
            updatedAt: record.updatedAt,
        });
    }

    async resolveFarmIdForPlot(plotId: PlotId): Promise<FarmId | null> {
        const record = await getDatabase().plotAreas.get(plotId);
        return record?.farmId as FarmId | undefined ?? null;
    }
}

