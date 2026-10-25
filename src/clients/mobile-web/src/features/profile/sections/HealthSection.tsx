/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Soil & Crop Health tab section.
 *
 * Thin wrapper around SoilHealthReportsManager. Since I7 (plr-d10, doctrine P5) that page only says
 * plainly that report upload is not built yet, so it needs no profile and saves nothing.
 */

import React from 'react';
import { SoilHealthReportsManager } from '../components/SoilHealthReportsManager';

const HealthSection: React.FC = () => <SoilHealthReportsManager />;

export default HealthSection;
