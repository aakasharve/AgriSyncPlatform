/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Purvesh-specific demo data fillers. Triggered only when the owner's
 * display name matches the demo persona — production sync paths should
 * never see these defaults applied.
 *
 * This module is isolated so the reconciler's main path does not have to
 * carry demo concerns inline.
 */

import { VerificationStatus, type CropProfile, type FarmOperator, type FarmerProfile, type Plot } from '../../../../types';
import { normalizeMojibakeText } from '../../../../shared/utils/textEncoding';

export function isPurveshDemoOwner(name: string): boolean {
    return name.trim().toLowerCase().includes('purvesh');
}

export function buildPurveshDemoProfileDefaults(receivedAtUtc: string): Partial<FarmerProfile> {
    return {
        village: 'Khardi, Nashik',
        phone: '9800000001',
        language: 'mr',
        verificationStatus: VerificationStatus.PhoneVerified,
        landHoldings: {
            value: 6,
            unit: 'Acre',
        },
        people: [
            { id: 'demo_shankar', name: 'Shankar Jadhav', role: 'Mukadam', phone: '9800000002', isActive: true, skills: ['Spraying', 'Irrigation'] },
            { id: 'demo_raju', name: 'Raju Bhosale', role: 'Worker', phone: '9800000003', isActive: true, skills: ['Weeding', 'Equipment'] },
            { id: 'demo_santosh', name: 'Santosh Kamble', role: 'Worker', phone: '9800000004', isActive: true, skills: ['Fertigation', 'Field Support'] },
        ],
        trust: {
            requirePinForVerification: false,
            reviewPolicy: 'AUTO_APPROVE_OWNER',
            autoApproveDelayDays: 1,
        },
        location: {
            lat: 20.1194,
            lon: 73.7722,
            source: 'manual',
            updatedAt: receivedAtUtc,
        },
        waterResources: [
            { id: 'water_main_well', type: 'Well', name: 'Main Well', isAvailable: true, notes: 'G1/G2 drip main source' },
            { id: 'water_bore_east', type: 'Borewell', name: 'East Borewell', isAvailable: true, notes: 'Turmeric and S2 support line' },
            { id: 'water_farm_pond', type: 'Farm Pond', name: 'Farm Pond', isAvailable: true, notes: 'Pomegranate and backup irrigation' },
            { id: 'water_canal_feed', type: 'Canal', name: 'Canal Feed', isAvailable: true, notes: 'Sugarcane S1 flood irrigation' },
        ],
        motors: [
            { id: 'motor_kirloskar_75', name: 'Kirloskar 7.5 HP', hp: 7.5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'water_main_well' },
            { id: 'motor_cri_5', name: 'CRI 5 HP', hp: 5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'water_bore_east' },
            { id: 'motor_solar_10', name: 'Solar 10 HP Pump', hp: 10, phase: '3', powerSourceType: 'Solar', linkedWaterSourceId: 'water_farm_pond' },
            { id: 'motor_diesel_mobile', name: 'Mobile Diesel Pump', hp: 5, phase: '1', powerSourceType: 'Generator', linkedWaterSourceId: 'water_canal_feed' },
        ],
        electricityTiming: {
            singlePhase: {
                patternMode: 'FIXED_WEEKLY',
                alternateWeeklyPattern: false,
                weekAOffWindows: [
                    { id: 'sp_morning', startTime: '06:00', endTime: '09:00', repeatRule: 'DAILY', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
                ],
                weekBOffWindows: [],
            },
            threePhase: {
                patternMode: 'FIXED_WEEKLY',
                alternateWeeklyPattern: false,
                weekAOffWindows: [
                    { id: 'tp_evening', startTime: '18:30', endTime: '21:30', repeatRule: 'DAILY', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
                ],
                weekBOffWindows: [],
            },
            updatedAt: receivedAtUtc,
        },
        machineries: [
            { id: 'machine_tractor', name: 'John Deere 5050', type: 'Tractor', ownership: 'Owned', defaultOperatorId: 'demo_shankar' },
            { id: 'machine_sprayer', name: 'Power Sprayer 400L', type: 'Sprayer', ownership: 'Owned', defaultOperatorId: 'demo_shankar', capacity: 400 },
            { id: 'machine_rotavator', name: 'Mini Rotavator', type: 'Rotavator', ownership: 'Rented', defaultOperatorId: 'demo_raju' },
            { id: 'machine_blower', name: 'Blower Sprayer', type: 'Sprayer', ownership: 'Owned', defaultOperatorId: 'demo_santosh', capacity: 200 },
        ],
        infrastructure: {
            waterManagement: 'Decentralized',
            filtrationType: 'Disc',
        },
    };
}

export function fillMissingProfileDetails(
    existingProfile: FarmerProfile | null,
    ownerOperator: FarmOperator,
    receivedAtUtc: string
): Partial<FarmerProfile> | null {
    if (!isPurveshDemoOwner(ownerOperator.name)) {
        return null;
    }

    if (existingProfile?.waterResources?.length || existingProfile?.motors?.length || existingProfile?.machineries?.length) {
        return null;
    }

    return buildPurveshDemoProfileDefaults(receivedAtUtc);
}

export function enrichPurveshDemoCrops(crops: CropProfile[], profile: FarmerProfile | null): CropProfile[] {
    if (!profile || !isPurveshDemoOwner(profile.name)) {
        return crops;
    }

    crops.forEach(crop => {
        crop.plots.forEach(plot => {
            const plotName = normalizeMojibakeText(plot.name);
            const mergeInfrastructure = (defaults: NonNullable<Plot['infrastructure']>) => {
                plot.infrastructure = {
                    irrigationMethod: plot.infrastructure?.irrigationMethod || defaults.irrigationMethod,
                    linkedMotorId: plot.infrastructure?.linkedMotorId || defaults.linkedMotorId,
                    dripDetails: plot.infrastructure?.dripDetails || defaults.dripDetails,
                    linkedMachineryIds: plot.infrastructure?.linkedMachineryIds?.length
                        ? plot.infrastructure.linkedMachineryIds
                        : defaults.linkedMachineryIds,
                };
            };

            if (plotName.includes('G1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'motor_kirloskar_75',
                    dripDetails: { pipeSize: '16mm', hasFilter: true, flowRatePerHour: 1400 },
                    linkedMachineryIds: ['machine_sprayer', 'machine_blower'],
                });
                return;
            }

            if (plotName.includes('G2')) {
                mergeInfrastructure({
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'motor_cri_5',
                    dripDetails: { pipeSize: '16mm', hasFilter: true, flowRatePerHour: 1100 },
                    linkedMachineryIds: ['machine_sprayer'],
                });
                return;
            }

            if (plotName.includes('P1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'motor_solar_10',
                    dripDetails: { pipeSize: '20mm', hasFilter: true, flowRatePerHour: 1500 },
                    linkedMachineryIds: ['machine_blower', 'machine_sprayer'],
                });
                return;
            }

            if (plotName.includes('S1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Flood',
                    linkedMotorId: 'motor_diesel_mobile',
                    linkedMachineryIds: ['machine_tractor', 'machine_rotavator'],
                });
                return;
            }

            if (plotName.includes('S2')) {
                mergeInfrastructure({
                    irrigationMethod: 'Flood',
                    linkedMotorId: 'motor_cri_5',
                    linkedMachineryIds: ['machine_tractor'],
                });
                return;
            }

            if (plotName.includes('T1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Sprinkler',
                    linkedMotorId: 'motor_cri_5',
                    linkedMachineryIds: ['machine_rotavator'],
                });
                return;
            }

            if (plotName.includes('B1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Flood',
                    linkedMotorId: 'motor_diesel_mobile',
                    linkedMachineryIds: ['machine_tractor'],
                });
            }
        });
    });

    return crops;
}
