/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P8) - what the Setup Hub counts for the water, motor, power and machine steps,
 * and which plot's water is बाकी. With the open farm's set (once the server has sent it) the FARM's set is the truth: sources, motors and machines as
 * the farm has them (a change waiting counts - it is shown with its honest line; a refused first save that never reached the server does not); power
 * is done when the farm's timetable is on the server or a change of it waits. Without the farm's set the phone profile is read exactly as before
 * (FIX-1's `powerTimesSaved`). Pure.
 */
import type { FarmerProfile } from '../../../domain/types/farm.types';
import { powerTimesSaved } from '../hubSteps';
import type { LocalFarmSetup, LocalItem } from './farmSetupLocal';
import { plotWaterPending } from './plotWaterModel';

export interface HubSetupFacts {
    waterCount: number;
    motorCount: number;
    machineCount: number;
    powerSaved: boolean;
}

/** A first save the server refused never existed on the farm: it is not counted (it stays on its page with its words). */
const exists = <T extends { revision: number }>(x: LocalItem<T>): boolean => !(x.state === 'refused' && x.item.revision === 0);

export function hubSetupFacts(farmSetup: LocalFarmSetup | null | undefined, profile: FarmerProfile): HubSetupFacts {
    if (farmSetup?.received) {
        const sources = farmSetup.waterSources.filter(exists);
        return {
            waterCount: sources.length,
            motorCount: sources.reduce((n, s) => n + s.item.motors.length, 0),
            machineCount: farmSetup.machines.filter(exists).length,
            powerSaved: !!farmSetup.powerTimes && exists(farmSetup.powerTimes),
        };
    }
    return {
        waterCount: profile.waterResources?.length ?? 0,
        motorCount: profile.motors?.length ?? 0,
        machineCount: profile.machineries?.length ?? 0,
        powerSaved: powerTimesSaved(profile.electricityTiming),
    };
}

/**
 * The water entry of the plot's red बाकी mark: true for a plot of THIS farm with no water answer, or a method with no live link. `undefined` when the
 * farm's set has not come (no water reason at all, as before). A plot the phone does not know is this farm's is never marked (FIX-2 is not this lane).
 */
export function plotWaterPendingFor(farmSetup: LocalFarmSetup | null | undefined): ((plotId: string) => boolean) | undefined {
    if (!farmSetup?.received) return undefined;
    const sources = farmSetup.waterSources.map(s => s.item);
    return plotId => farmSetup.farmPlotIds.has(plotId) && plotWaterPending(farmSetup.plotWater.get(plotId)?.item, sources);
}
