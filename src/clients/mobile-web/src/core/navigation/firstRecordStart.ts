/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1a (CTO ruling 2). "बोलायला सुरुवात करा" on
 * the first-record card opens the NORMAL voice entry of the real farm — the log tab's own flow, the path "झालेले काम सांगा"
 * takes — through the ONE door another screen uses to open the recorder (`openLogFlow`: something already waiting there is
 * never touched; otherwise voice mode, the log tab).
 *
 *   - A farm with no crop yet: the crop step would show one tile, "संपूर्ण शेत" (`CropPlotStepper`), and a one-tile question
 *     is friction (P9). The whole farm is chosen for him, so the tab opens on "संपूर्ण शेत" with the mic. A whole-farm
 *     record needs no crop and no plot, and the server accepts it (`entireFarmJourney.test.ts`).
 *   - A farm with crops, or a seat that is not offered the whole farm (a plot-limited seat, F03): the normal crop step, as
 *     "झालेले काम सांगा" opens it (`WorkHome.onTell`: no place chosen, the crop question).
 *
 * Nothing about WHEN a record is saved changes here: what he says goes through the same recorder and the same auto-save.
 */
import type { AppRouterContext } from './routeContext';
import { openLogFlow, type LogFlowDoorCtx } from './openLogFlow';
import { EMPTY_SCOPE, FARM_GLOBAL, scopeForPlace } from '../speak/speakFlow';
import { requestEntryOpening } from '../../features/logs/components/entry/entryOpening';

export type FirstRecordStartCtx = LogFlowDoorCtx & Pick<AppRouterContext, 'currentRoute' | 'setCurrentRoute'>;

/** What the farm's phone knows about the place, at the tap. */
export interface FirstRecordPlace {
    /** The crops this phone holds for the farm. */
    cropCount: number;
    /** False for a seat limited to chosen plots: "संपूर्ण शेत" is not offered to it (F03). */
    wholeFarmOffered: boolean;
}

/** How the voice entry was opened: on the whole farm's mic, on the crop question, or on what already waited there. */
export type FirstRecordStart = 'wholeFarm' | 'cropStep' | 'waiting';

export function startFirstRecord(ctx: FirstRecordStartCtx, place: FirstRecordPlace): FirstRecordStart {
    if (ctx.currentRoute !== 'main') ctx.setCurrentRoute('main');
    if (openLogFlow(ctx) === 'waiting') return 'waiting';
    if (place.cropCount === 0 && place.wholeFarmOffered) {
        ctx.setLogScope(scopeForPlace({ cropId: FARM_GLOBAL }));
        return 'wholeFarm';
    }
    ctx.setLogScope(EMPTY_SCOPE);
    requestEntryOpening();
    return 'cropStep';
}
