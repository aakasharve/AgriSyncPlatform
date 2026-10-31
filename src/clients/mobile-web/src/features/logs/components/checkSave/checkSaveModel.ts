/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-58 / D-59) — what "तपासा आणि जतन करा" shows
 * about a parse that was not saved by itself. Pure.
 *
 *   - THE CASE: nothing understood (`unclear`: only "पुन्हा सांगा" and typing — there is nothing to save), Sathi thinks it
 *     was another plot (`otherPlot`: the place must be chosen in the canonical steps first, his guess marked), the phone
 *     could not write it (`notWritten`: "पुन्हा जतन करा"), or simply to check and save (`check`: an understood offline
 *     recording from आवाज नोंदी).
 *   - WHAT WAS UNDERSTOOD: the parse read exactly as the save will read it (`LogFactory.createFromVoiceResult` on the
 *     place it would land on), shown the result screen's way (`partEntriesOf`) — never a second reading of it.
 */
import type { AgriLogResponse, CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../../types';
import { LogFactory } from '../../../../core/domain/LogFactory';
import { isAutoSavableVoiceDraft } from '../../../../app/helpers/autoSavedVoiceLog';
import type { DeclineReason } from '../../../voice/draftFacts';
import { cropNameIn, entryText, withoutQuotes } from '../voiceResult/partNames';
import { recordingOf, withoutInventedStoppage, type BlockerEntry, type PartEntry } from '../voiceResult/resultModel';

export type CheckCase = 'unclear' | 'otherPlot' | 'notWritten' | 'check';

const FARM_GLOBAL = 'FARM_GLOBAL';
const NO_WHO = { youIds: new Set<string>(), nameOf: () => undefined, youLabel: '', unknownLabel: '' };

export const WHOLE_FARM_SCOPE: LogScope = { selectedCropIds: [FARM_GLOBAL], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

/** Is this a place a save can land on (a plot, or the whole farm)? */
export const hasPlace = (scope: LogScope | null | undefined): scope is LogScope =>
    !!scope && (scope.selectedPlotIds.length > 0 || scope.selectedCropIds.includes(FARM_GLOBAL));

/** Why he is on this screen: the reason the auto-save gave, else read from the parse itself. */
export function checkCaseOf(draft: AgriLogResponse, reason: DeclineReason | undefined): CheckCase {
    if (!isAutoSavableVoiceDraft(draft)) return 'unclear';
    if (reason) return reason;
    return draft.suggestedContext?.cropId && draft.suggestedContext?.plotId ? 'otherPlot' : 'check';
}

/** The plot Sathi suggested, as a one-plot place, or null. */
export function guessScope(draft: AgriLogResponse): LogScope | null {
    const s = draft.suggestedContext;
    return s?.cropId && s?.plotId ? { selectedCropIds: [s.cropId], selectedPlotIds: [s.plotId], mode: 'single', applyPolicy: 'broadcast' } : null;
}

/** "द्राक्ष · G1, G2" (crop names in his language), the whole farm by its own name; '' for no place. */
export function placeLabel(scope: LogScope | null | undefined, crops: readonly CropProfile[], language: string | null | undefined, wholeFarm: string): string {
    if (!scope) return '';
    if (scope.selectedCropIds.includes(FARM_GLOBAL)) return wholeFarm;
    const parts = crops.filter(c => scope.selectedCropIds.includes(c.id)).map(c => {
        const plots = (c.plots ?? []).filter(p => scope.selectedPlotIds.includes(p.id)).map(p => p.name).filter(Boolean);
        return [cropNameIn(c.name, language), plots.join(', ')].filter(Boolean).join(' · ');
    });
    return parts.join(' + ');
}

/** The logs this parse would become on that place (never saved): the same factory the save uses. */
export function previewLogs(draft: AgriLogResponse, scope: LogScope | null, crops: CropProfile[], profile: FarmerProfile): DailyLog[] {
    try {
        return LogFactory.createFromVoiceResult(draft, hasPlace(scope) ? scope : WHOLE_FARM_SCOPE, crops, profile);
    } catch {
        // A parse the factory cannot build stays on screen as his words; nothing is guessed in its place.
        return [];
    }
}

/** What was understood, part by part, the result screen's way (his words are shown once, above). */
export function understoodOf(logs: readonly DailyLog[], language: string | null | undefined): { entries: PartEntry[]; blockers: BlockerEntry[] } {
    if (logs.length === 0) return { entries: [], blockers: [] };
    const view = withoutInventedStoppage(recordingOf(logs, { ...NO_WHO, language: language ?? undefined }), logs);
    return {
        entries: withoutQuotes(view.entries).map(e => ({ ...e, value: entryText(e, language) || e.value })),
        blockers: withoutQuotes(view.blockers),
    };
}
