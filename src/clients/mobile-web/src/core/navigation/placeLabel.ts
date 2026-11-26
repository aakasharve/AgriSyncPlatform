/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "द्राक्ष · G1" for the recorder's plots (crop names strictly in his language), the whole farm by its own name.
 * Moved verbatim from `core/speak/SpeakHost.tsx` (spec voice-flow-v2-2026-11-23) so `logRecorder.tsx` can use it
 * without a circular import (SpeakHost imports logRecorder); SpeakHost re-exports it, so every caller is unchanged.
 */
import type { LogScope } from '../../types';
import type { AppRouterContext } from './routeContext';
import { placeWords } from '../../shared/names/placeWords';

/** The whole-farm crop id (the same value as `core/speak/speakFlow.FARM_GLOBAL`). */
const FARM_GLOBAL = 'FARM_GLOBAL';

export function placeLabelOf(scope: LogScope, crops: AppRouterContext['crops'], language: string | null | undefined, wholeFarm: string): string | undefined {
    if (scope.selectedCropIds.includes(FARM_GLOBAL)) return wholeFarm;
    const crop = crops.find(c => scope.selectedCropIds.includes(c.id));
    if (!crop) return undefined;
    const plots = (crop.plots ?? []).filter(p => scope.selectedPlotIds.includes(p.id)).map(p => p.name).filter(Boolean);
    // lane OF fix 1 (10): never "द्राक्ष · द्राक्ष G1"; founder 2026-11-21: from 4 plots a count ("द्राक्ष · सर्व १५ प्लॉट"), never fifteen names cut off
    return placeWords(crop.name, plots, language, (crop.plots ?? []).length) || undefined;
}
