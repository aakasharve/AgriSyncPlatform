/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-1/2/3) — what the तुलना tab is given.
 *
 * Kept apart from `mainView.tsx` (which pulls in the whole recorder) so the wiring can be checked on its own:
 *   - nothing for a person who may not open तुलना (a worker, `hiddenViews.ts`) — not even for one frame;
 *   - no back of its own: तुलना is a home tab (PLR-D9 N5) — the switcher and the bottom bar are the way out;
 *   - "झालं, सांगा" opens the real log flow for THAT plot (crop + plot picked, voice ready) — unless a draft
 *     is waiting, which is shown instead and never moved to another plot (`openLogFlow.ts`);
 *   - "पूर्ण शेड्यूल पाहा" / "शेड्यूल लावा" open the real शेड्यूल page.
 */
import type { CropProfile, DailyLog, FarmerProfile } from '../../types';
import type { AppRouterContext } from './routeContext';
import { openLogFlow } from './openLogFlow';

export interface CompareTabProps {
    crops: CropProfile[];
    logs: DailyLog[];
    onTellPlot: (cropId: string, plotId: string) => void;
    onTell: () => void;
    onOpenSchedule: () => void;
    /** Lane CMP-T: the farmer's profile, for the reason sheet's mic (the same parse the log's recorder is given). */
    farmerProfile?: FarmerProfile;
}

export function compareTabProps(ctx: AppRouterContext): CompareTabProps | null {
    if (ctx.currentRoute !== 'main' || ctx.mainView !== 'compare') return null;
    if (ctx.hiddenViews?.includes('compare')) return null;
    return {
        crops: ctx.crops,
        logs: ctx.history,
        // Through the one door (`openLogFlow.ts`): a waiting draft is never moved to this plot, and a
        // just-finished save gives way to a fresh recorder.
        onTellPlot: (cropId, plotId) => { openLogFlow(ctx, { cropId, plotId }); },
        onTell: () => { openLogFlow(ctx); },
        onOpenSchedule: () => ctx.setCurrentRoute('schedule'),
        farmerProfile: ctx.farmerProfile,
    };
}
