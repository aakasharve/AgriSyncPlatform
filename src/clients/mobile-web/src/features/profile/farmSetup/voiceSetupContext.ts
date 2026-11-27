/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P9; contract §5.3) - the voice parse reads the farm's motors, sources and machines
 * and each plot's method and motor from the profile and crops it is handed (`BackendAiClient.buildContext`, infrastructure/ai: the AI lane's, not edited
 * here). Once the server has sent the OPEN farm's set, the recorder is handed a profile and crops whose setup is THAT set: the same shapes, so the AI
 * call's context has exactly the keys it had (no prompt change). Without the set, the phone profile and crops go as they are (the same objects).
 */
import { useMemo } from 'react';
import type { CropProfile, FarmerProfile, PlotInfrastructure } from '../../../domain/types/farm.types';
import type { LocalFarmSetup } from './farmSetupLocal';
import { toFarmMotor, toMachinery, toWaterResource } from './farmSetupView';
import { liveLinks } from './plotWaterModel';
import { useFarmSetup } from './useFarmSetup';

const METHOD: Record<string, PlotInfrastructure['irrigationMethod']> = { drip: 'Drip', flood: 'Flood', sprinkler: 'Sprinkler', none: 'None' };

export function withFarmSetup(profile: FarmerProfile, crops: CropProfile[], local: LocalFarmSetup | null | undefined): { profile: FarmerProfile; crops: CropProfile[] } {
    if (!local?.received) return { profile, crops };
    const sources = local.waterSources.map(s => s.item);
    const motors = sources.flatMap(s => s.motors.map(m => ({ motor: m, sourceId: s.id })));
    const farmProfile: FarmerProfile = {
        ...profile,
        waterResources: sources.map(toWaterResource),
        motors: motors.map(({ motor, sourceId }) => toFarmMotor(motor, sourceId)),
        machineries: local.machines.map(m => toMachinery(m.item)),
    };
    const farmCrops = crops.map(crop => ({
        ...crop,
        plots: crop.plots.map(plot => {
            const entry = local.plotWater.get(plot.id)?.item;
            if (!entry) return plot;
            const motorId = liveLinks(entry, sources).find(l => l.motorId)?.motorId ?? undefined;
            const flow = motorId ? motors.find(m => m.motor.id === motorId)?.motor.drip?.flowLitresPerHour ?? undefined : undefined;
            const infrastructure: PlotInfrastructure = {
                ...plot.infrastructure,
                irrigationMethod: METHOD[entry.method] ?? 'None',
                linkedMotorId: motorId,
                dripDetails: { hasFilter: false, ...(flow !== undefined ? { flowRatePerHour: flow } : {}) },
            };
            return { ...plot, infrastructure };
        }),
    }));
    return { profile: farmProfile, crops: farmCrops };
}

/** The recorder's profile and crops for the open farm (the same objects while the farm's set has not come). */
export function useVoiceSetupContext(farmId: string | null | undefined, profile: FarmerProfile, crops: CropProfile[]): { profile: FarmerProfile; crops: CropProfile[] } {
    const local = useFarmSetup(farmId);
    return useMemo(() => withFarmSetup(profile, crops, local), [profile, crops, local]);
}
