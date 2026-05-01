/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Soil & Crop Health tab section.
 *
 * Thin wrapper around the existing SoilHealthReportsManager so the
 * orchestrator can render `<HealthSection profile=… onUpdate=… />`
 * uniformly with the other tabs.
 */

import React from 'react';
import { FarmerProfile } from '../../../types';
import { SoilHealthReportsManager } from '../components/SoilHealthReportsManager';

interface HealthSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
}

const HealthSection: React.FC<HealthSectionProps> = ({ profile, onUpdate }) => {
    return <SoilHealthReportsManager profile={profile} onUpdate={onUpdate} />;
};

export default HealthSection;
