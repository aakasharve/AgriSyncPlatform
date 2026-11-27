/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P1) - the Dexie side of `FarmSetupRepository`: the four v33 stores, a SERVER
 * CACHE (P10). `replaceFarms` writes each farm's set whole (its old rows leave first); it opens no transaction of its own when called inside the pull's
 * transaction (Dexie joins it), and one of its own otherwise. Nothing here ever holds a change this phone made: those stay in the mutation queue.
 */
import type { FarmSetupRepository } from '../../application/ports/FarmSetupRepository';
import type { FarmSetupSet } from '../../domain/types/farmSetup.types';
import type { AgriLogDatabase } from './DexieDatabase';

export class DexieFarmSetupRepository implements FarmSetupRepository {
    constructor(private readonly db: AgriLogDatabase) { }

    private stores() {
        return [this.db.farmWaterSources, this.db.farmMachines, this.db.farmPowerTimes, this.db.plotWater];
    }

    async read(farmId: string): Promise<FarmSetupSet | null> {
        const mark = await this.db.farmPowerTimes.get(farmId);
        if (!mark) return null;
        const [waterSources, machines, plotWater] = await Promise.all([
            this.db.farmWaterSources.where('farmId').equals(farmId).toArray(),
            this.db.farmMachines.where('farmId').equals(farmId).toArray(),
            this.db.plotWater.where('farmId').equals(farmId).toArray(),
        ]);
        const byName = <T extends { name: string; id: string }>(a: T, b: T) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
        return {
            farmId,
            waterSources: waterSources.sort(byName),
            powerTimes: mark.powerTimes,
            machines: machines.sort(byName),
            plotWater,
            receivedAtUtc: mark.receivedAtUtc,
        };
    }

    async replaceFarms(sets: readonly FarmSetupSet[]): Promise<void> {
        if (sets.length === 0) return;
        await this.db.transaction('rw', this.stores(), async () => {
            await this.removeRows(sets.map(s => s.farmId));
            for (const set of sets) {
                if (set.waterSources.length > 0) await this.db.farmWaterSources.bulkPut(set.waterSources);
                if (set.machines.length > 0) await this.db.farmMachines.bulkPut(set.machines);
                if (set.plotWater.length > 0) await this.db.plotWater.bulkPut(set.plotWater);
                await this.db.farmPowerTimes.put({ farmId: set.farmId, powerTimes: set.powerTimes, receivedAtUtc: set.receivedAtUtc });
            }
        });
    }

    async removeFarms(farmIds: readonly string[]): Promise<void> {
        if (farmIds.length === 0) return;
        await this.db.transaction('rw', this.stores(), () => this.removeRows(farmIds));
    }

    private async removeRows(farmIds: readonly string[]): Promise<void> {
        const ids = [...farmIds];
        await this.db.farmWaterSources.where('farmId').anyOf(ids).delete();
        await this.db.farmMachines.where('farmId').anyOf(ids).delete();
        await this.db.plotWater.where('farmId').anyOf(ids).delete();
        await this.db.farmPowerTimes.bulkDelete(ids);
    }
}
