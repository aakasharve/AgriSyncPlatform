// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3)
//
// The plot area in acres — the server's unit — from what the farmer said in his own unit.
// Pure: used by the send path and by the download path alike.

import type { LandUnit } from '../../../types';

const ACRES_PER_UNIT: Record<LandUnit, number> = {
    Acre: 1,
    Guntha: 1 / 40,
    Are: 0.0247105,
};

/** Area in acres, to 4 places. 0 when not stated — and a 0 is never sent. */
export function areaInAcres(value: number | undefined, unit: LandUnit | undefined): number {
    if (!value || !Number.isFinite(value) || value < 0) return 0;
    const factor = ACRES_PER_UNIT[unit ?? 'Acre'] ?? 1;
    return Math.round(value * factor * 10000) / 10000;
}
