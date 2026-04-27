import type {
    Farm,
    FarmId,
    PlotAreaRecord,
    PlotId,
} from '../../domain/farmGeography/types';
import type { FarmGeographyRepository } from '../ports/FarmGeographyPort';

export class InMemoryFarmRepository implements FarmGeographyRepository {
    private readonly farms = new Map<FarmId, Farm>();
    private readonly plotAreas = new Map<PlotId, PlotAreaRecord>();

    async getFarm(farmId: FarmId): Promise<Farm | null> {
        return this.farms.get(farmId) ?? null;
    }

    async listAccessibleFarms(): Promise<Farm[]> {
        return [...this.farms.values()];
    }

    async saveFarm(farm: Farm): Promise<void> {
        this.farms.set(farm.id, farm);
    }

    async getPlotArea(plotId: PlotId): Promise<PlotAreaRecord | null> {
        return this.plotAreas.get(plotId) ?? null;
    }

    async savePlotArea(record: PlotAreaRecord): Promise<void> {
        this.plotAreas.set(record.plotId, record);
    }

    async resolveFarmIdForPlot(plotId: PlotId): Promise<FarmId | null> {
        return this.plotAreas.get(plotId)?.farmId ?? null;
    }
}

