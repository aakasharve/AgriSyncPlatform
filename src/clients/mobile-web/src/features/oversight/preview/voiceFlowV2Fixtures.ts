/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 13a) — seed data for clicking the voice flow v2 journey in the dev-only full-app
 * preview (`OversightAppPreview.tsx`, `?preview=oversight`, only with `VITE_VOICE_FLOW_V2=1`). Every value here is
 * fabricated for the preview: never fetched from a backend, never read from or written to Dexie.
 *
 * Rules (the same as `previewAppFixtures.ts`, with ONE exception): ids, crop/plot names and operator names stay Latin.
 * The exception is what HE SAYS — the transcript, the phrases the parse kept, and the product words the parser writes in
 * Marathi — because the step list and the result screen exist to show his Marathi words back to him; a Latin stand-in
 * would prove nothing about those screens. `previewAppFixtures.ts` itself stays Latin-only (its own header).
 *
 * The parse is shaped like a real one AFTER the app's one reading of a parse (`normalizeParsedLog`): Marathi product
 * names that the input catalog knows ("कॉन्फिडॉर", "युथेन एम-45", "19:19:19"), the spray's water on its own row
 * (`carrierVolume` / `carrierUnit`, the names `normalizeInputDrift` writes), the drip release's water as a fertigation
 * row, and nothing he did not say (no wage, no rent, no hours of the tractor).
 *
 * Reachability: imported only by the preview, which `App.tsx` loads lazily behind `IS_OVERSIGHT_PREVIEW_ENABLED`
 * (`import.meta.env.DEV`), so a production build drops this module and its strings.
 */
import type { AgriLogResponse, DailyLog, FarmOperator } from '../../../types';
import { LogVerificationStatus, OperatorCapability } from '../../../types';

/** The plot the journey is clicked on: the seeded farm's Grapes A (`previewAppFixtures.PREVIEW_CROPS`). */
export const PREVIEW_V2_PLOT = { cropId: 'crop-grapes', cropName: 'Grapes', plotId: 'plot-grapes-a', plotName: 'Grapes A' } as const;

/** The second speaker of the day: a मुकादम on this farm (role only; the name stays Latin like the other operators). */
export const PREVIEW_V2_MUKADAM: FarmOperator = {
    id: 'op-pawar',
    name: 'Pawar',
    role: 'MUKADAM',
    capabilities: [OperatorCapability.LOG_DATA],
    isVerifier: false,
    isActive: true,
};

/** A phrase he said that the parse could not place — unique to this file, so a production bundle can be searched for it. */
export const PREVIEW_V2_UNCLEAR = 'मागच्या बाजूचं उद्या बघू';

const PHRASE = {
    labour: 'आज प्लॉट दोन मध्ये सात बाया आणि तीन गडी होते',
    spray: 'सकाळी चार तास फवारणी केली',
    mix: 'कॉन्फिडॉर अडीचशे एमएल आणि युथेन एम पंचेचाळीस पाचशे ग्रॅम, दोनशे लिटर पाण्यात',
    drip: 'दुपारी ठिबकने एकोणीस एकोणीस एकोणीस पाच किलो सोडलं',
    water: 'दोन तास पाणी दिलं',
    tractor: 'ट्रॅक्टरने ब्लोअर चालवला',
    diesel: 'डिझेलला सहाशे रुपये गेले',
    planned: 'परवा साफ मारायचं आहे',
} as const;

/** His words, as the speech-to-text would write them (the phrases above, in order, plus the one it could not place). */
export const PREVIEW_V2_TRANSCRIPT = `${PHRASE.labour}, ${PHRASE.spray}, ${PHRASE.mix}, ${PHRASE.drip}, ${PHRASE.water}, ${PHRASE.tractor}, `
    + `${PHRASE.diesel}, ${PHRASE.planned}, ${PREVIEW_V2_UNCLEAR}.`;

/** The water he stated on the spray row itself (the parse's own field names after `normalizeInputDrift`). */
type SprayRow = AgriLogResponse['inputs'][number] & { carrierVolume: number; carrierUnit: string };

const spray: SprayRow = {
    id: 'ev-v2-spray',
    method: 'Spray',
    carrierMedium: 'water',
    carrierType: 'Liters',
    carrierVolume: 200,
    carrierUnit: 'L',
    sourceText: PHRASE.mix,
    mix: [
        { id: 'mix-v2-confidor', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' },
        { id: 'mix-v2-uthane', productName: 'युथेन एम-45', dose: 500, unit: 'g' },
    ],
};

/** The parse the preview's harness hands to the step list and saves (one recording: 7 women + 3 men, a spray, a drip release…). */
export const PREVIEW_V2_DRAFT: AgriLogResponse = {
    summary: '',
    dayOutcome: 'WORK_RECORDED',
    fullTranscript: PREVIEW_V2_TRANSCRIPT,
    cropActivities: [
        { id: 'act-v2-spray', title: 'फवारणी', workTypes: ['Spraying'], status: 'completed', notes: 'चार तास', sourceText: PHRASE.spray },
    ],
    labour: [
        { id: 'lab-v2', type: 'HIRED', femaleCount: 7, maleCount: 3, count: 10, durationHours: 4, activity: 'Spraying', sourceText: PHRASE.labour },
    ],
    inputs: [
        spray,
        {
            id: 'ev-v2-drip',
            method: 'Drip',
            sourceText: PHRASE.drip,
            mix: [{ id: 'mix-v2-npk', productName: '19:19:19', npkGrade: '19:19:19', dose: 5, unit: 'kg' }],
        },
    ],
    irrigation: [
        { id: 'irr-v2-drip', method: 'Drip', role: 'fertigation', durationHours: 2, sourceText: PHRASE.water },
    ],
    machinery: [
        { id: 'mach-v2-tractor', type: 'tractor', ownership: 'owned', implement: 'blower', fuelType: 'diesel', sourceText: PHRASE.tractor },
    ],
    activityExpenses: [
        {
            id: 'exp-v2-diesel', reason: 'डिझेल', category: 'fuel', totalAmount: 600, sourceText: PHRASE.diesel,
            items: [{ id: 'exp-v2-diesel-item', name: 'डिझेल', total: 600 }],
        },
    ],
    plannedTasks: [
        { title: 'साफ फवारणी', dueHint: 'परवा', category: 'general', sourceText: PHRASE.planned, systemInterpretation: 'Spray planned in two days' },
    ],
    unclearSegments: [
        { id: 'unclear-v2-1', rawText: PREVIEW_V2_UNCLEAR, confidence: 0.4, reason: 'incomplete_sentence', userMessage: '' },
    ],
    missingSegments: [],
};

/** "HH:MM" on that day in India (the app shows every time in IST, whatever the device clock's zone), as an ISO instant. */
const todayAt = (dateKey: string, hhmm: string): string => new Date(`${dateKey}T${hhmm}:00+05:30`).toISOString();

/**
 * The day's earlier recording on the same plot, by the मुकादम at 07:10: six women came for pruning. Saved from his voice
 * and not yet confirmed, like every voice record — so the result screen's "earlier today" row and its speakers row show
 * two people (him, then the owner who records the journey).
 */
export function buildPreviewV2EarlierLog(today: string): DailyLog {
    const said = 'सकाळी सहा बाया छाटणीला आल्या, दहा वाजता संपलं.';
    return {
        id: 'log-v2-pawar-earlier',
        date: today,
        context: {
            selection: [{
                cropId: PREVIEW_V2_PLOT.cropId, cropName: PREVIEW_V2_PLOT.cropName,
                selectedPlotIds: [PREVIEW_V2_PLOT.plotId], selectedPlotNames: [PREVIEW_V2_PLOT.plotName],
            }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [{ id: 'act-v2-pruning', title: 'छाटणी', workTypes: ['Pruning'], status: 'completed', sourceText: said }],
        irrigation: [],
        labour: [{ id: 'lab-v2-pruning', type: 'HIRED', femaleCount: 6, count: 6, activity: 'Pruning', sourceText: said }],
        inputs: [],
        machinery: [],
        fullTranscript: said,
        autoSavedFromVoice: true,
        meta: { createdAtISO: todayAt(today, '07:10'), createdByOperatorId: PREVIEW_V2_MUKADAM.id },
        verification: { status: LogVerificationStatus.DRAFT, required: true },
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
    };
}

/**
 * The preview's history with the flag on: the seeded day, minus today's seeded entries on the journey's plot (they would
 * stand as two more "earlier" recordings by other people), plus the मुकादम's one earlier recording. Other plots, other
 * days and the oversight header's people keep their seeded entries.
 */
export function previewV2History(seed: readonly DailyLog[], today: string): DailyLog[] {
    const onJourneyPlot = (log: DailyLog): boolean =>
        log.date === today && (log.context?.selection ?? []).some(s => s.selectedPlotIds.includes(PREVIEW_V2_PLOT.plotId));
    return [buildPreviewV2EarlierLog(today), ...seed.filter(log => !onJourneyPlot(log))];
}
