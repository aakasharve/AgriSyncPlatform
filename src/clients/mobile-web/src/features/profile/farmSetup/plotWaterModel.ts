/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone tasks P7-P8; contract §2.2, CTO Q4) - what a plot's water answer SAYS, read the
 * same way by the plot card, the red बाकी mark and the hub's count. Pure.
 *   - no entry at all          -> `notAsked`  : never asked, बाकी;
 *   - `method: 'none'`         -> `none`      : "पाण्याची सोय नाही" - an answer, NOT बाकी;
 *   - a method and live links  -> `linked`    : done;
 *   - a method and NO live link (none sent, or every source / motor it named is gone) -> `missingLink`: saved, still बाकी (CTO Q4).
 * A link is LIVE only while its source - and its motor, when it names one - is in the farm's set as this phone knows it: a removed motor never
 * shows as a dead name (the server drops such links too, in the same save).
 */
import type { FarmSetupWaterSource, PlotWaterLink, PlotWaterSetup } from '../../../domain/types/farmSetup.types';
import { farmSetupWords } from './farmSetupWords';

export type PlotWaterStatus = 'notAsked' | 'none' | 'linked' | 'missingLink';

export function liveLinks(entry: Pick<PlotWaterSetup, 'links'> | null | undefined, sources: readonly FarmSetupWaterSource[]): PlotWaterLink[] {
    if (!entry) return [];
    const byId = new Map(sources.map(s => [s.id, s]));
    return entry.links.filter(l => {
        const source = byId.get(l.waterSourceId);
        return !!source && (l.motorId === null || source.motors.some(m => m.id === l.motorId));
    });
}

export function plotWaterStatus(entry: PlotWaterSetup | null | undefined, sources: readonly FarmSetupWaterSource[]): PlotWaterStatus {
    if (!entry) return 'notAsked';
    if (entry.method === 'none') return 'none';
    return liveLinks(entry, sources).length > 0 ? 'linked' : 'missingLink';
}

/** The red बाकी mark: never asked, or a method with no live link. "पाण्याची सोय नाही" is an answer. */
export function plotWaterPending(entry: PlotWaterSetup | null | undefined, sources: readonly FarmSetupWaterSource[]): boolean {
    const status = plotWaterStatus(entry, sources);
    return status === 'notAsked' || status === 'missingLink';
}

/** The plot card's one line: "ठिबक · १ जोडणी", "पाण्याची सोय नाही", "ठिबक · पाण्याची सोय बाकी", or "पाण्याची सोय बाकी". */
export function plotWaterLine(entry: PlotWaterSetup | null | undefined, sources: readonly FarmSetupWaterSource[], language?: string | null): string {
    const w = farmSetupWords(language).plotWater;
    const status = plotWaterStatus(entry, sources);
    if (!entry || status === 'notAsked') return w.notSet;
    const method = w.methods[entry.method];
    if (status === 'none') return method;
    if (status === 'missingLink') return `${method} · ${w.notSet}`;
    return w.line(method, liveLinks(entry, sources).length);
}
