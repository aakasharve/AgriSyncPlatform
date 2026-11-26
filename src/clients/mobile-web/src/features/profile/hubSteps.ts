/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The सेट-अप केंद्र's steps, in the founder's order (repair FIX-1 item 3; R2-A 08 + section J,
 * founder 27 Nov): infrastructure before crop and plot.
 *
 *   माझी ओळख → पाण्याचे स्रोत → मोटर → वीज आणि वेळापत्रक → पिकं आणि प्लॉट → माझी टीम → यंत्रं → माती व पाणी अहवाल
 *
 * Water, motor and power are ONE page (`UtilitiesSection`) shown as three steps, so each step names
 * the page it opens. Pure: no React, so the order and the "is it really saved" rules are tested alone.
 */
import type { ElectricityTimingConfiguration } from '../../domain/types/farm.types';
import type { ProfileTab } from './ProfilePage';

export type HubStepId = 'identity' | 'water' | 'motor' | 'power' | 'structure' | 'team' | 'machines' | 'health';

/** The one order: the hub's rows and "पुढचं" both follow it. */
export const HUB_STEP_ORDER: readonly HubStepId[] = [
    'identity', 'water', 'motor', 'power', 'structure', 'team', 'machines', 'health',
];

/** The page each step opens (the three water / motor / power steps share one). */
export const HUB_STEP_TAB: Record<HubStepId, ProfileTab> = {
    identity: 'identity',
    water: 'utils',
    motor: 'utils',
    power: 'utils',
    structure: 'structure',
    team: 'team',
    machines: 'machines',
    health: 'health',
};

/**
 * Has the farmer really saved his power times? The app starts every phone with a timetable of its
 * own (no power cut at all), so the timetable being there proves nothing. True when he pressed
 * जतन करा on the page (`savedByFarmerAt`), or — a phone that saved before that mark existed — when
 * any power cut is set (the starting timetable has none, so the farmer set it).
 */
export function powerTimesSaved(timing: ElectricityTimingConfiguration | undefined | null): boolean {
    if (!timing) return false;
    if (timing.savedByFarmerAt) return true;
    return [timing.singlePhase, timing.threePhase].some(
        phase => (phase?.weekAOffWindows?.length ?? 0) > 0 || (phase?.weekBOffWindows?.length ?? 0) > 0,
    );
}
