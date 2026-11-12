/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 7; founder D-137 Q10 = 1; v3 README "VARIETY FACTS") - the QUIET variety line.
 *
 * The plot's own variety is a phone-only free-text field (`Plot.variety`, the server has none). A plot DOWNLOADED from the server carries its crop's name
 * as its "variety" (`plotSchedule.ts`), which is not a variety (`PlotDayCards.tsx` reads it the same way). The line is drawn only when both sides name a
 * real variety and they differ; "हे पाळा" still works whatever it says. Soil, region, climate: tags only, no line - the phone knows nothing of a
 * plot's values.
 */
import { cropNameIn } from '../../../shared/names/namesIn';

/** The variety a plot really carries, else null (empty, missing, or just the crop's own name in either language). */
export function plotVarietyOf(plot: { variety?: string | null } | null | undefined, cropName: string): string | null {
    const variety = plot?.variety?.trim();
    if (!variety) return null;
    if (variety.toLowerCase() === cropName.trim().toLowerCase()) return null;
    if (cropNameIn(variety, 'mr') === cropNameIn(cropName, 'mr')) return null;
    return variety;
}

export interface VarietyMismatch { schedule: string; plot: string }

/** Devanagari or not: the only two scripts the app's variety names are written in. */
const isDevanagari = (text: string): boolean => /[\u0900-\u097F]/.test(text);

/** The two names for the grey line, or null when there is nothing to say. */
export function varietyMismatch(
    scheduleVariety: string | null | undefined,
    plot: { variety?: string | null } | null | undefined,
    cropName: string,
): VarietyMismatch | null {
    const schedule = scheduleVariety?.trim();
    const plotVariety = plotVarietyOf(plot, cropName);
    if (!schedule || !plotVariety) return null;
    if (schedule.toLowerCase() === plotVariety.toLowerCase()) return null;
    // fix round 1 (P008): "भगवा" and "Bhagwa" are one variety written in two scripts - the phone cannot tell a different variety from a different
    // spelling across scripts, so it says nothing (never a false claim). The line is for two names in the SAME script that differ.
    if (isDevanagari(schedule) !== isDevanagari(plotVariety)) return null;
    return { schedule, plot: plotVariety };
}
