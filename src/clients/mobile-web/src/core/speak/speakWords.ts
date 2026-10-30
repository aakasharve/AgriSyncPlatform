/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane MIC-1) — the words the ONE mic adds around the recorder: one
 * line saying WHY he is speaking (the purpose band) and where. One language at a time (Marathi mode: Marathi only;
 * English mode: English only). Every line is PROPOSED unless it says REUSED. The recorder's own words (the green mic,
 * "बोलता येत नसेल तर इथे लिहा", the stop and cancel) are the recorder's and are not repeated here.
 */
import { RESULT_STR } from '../../features/logs/components/voiceResult/resultStrings';
import { partNameIn } from '../../features/logs/components/voiceResult/partNames';
import type { PartKey } from '../../features/logs/components/voiceResult/resultModel';
import type { SpeakPurpose } from './speakStore';

export interface SpeakBand { title: string; hint?: string }

export interface SpeakWords {
    back: string;
    wholeFarm: string;
    band: (purpose: SpeakPurpose, extra: { part?: PartKey; question?: string }) => SpeakBand;
}

const mr: SpeakWords = {
    back: RESULT_STR.back, // REUSED — common.back
    wholeFarm: RESULT_STR.wholeFarm, // REUSED
    band: (purpose, { part, question }) => {
        switch (purpose) {
            case 'fillPart':
                // PROPOSED (Marathi)
                return part ? { title: `${partNameIn(part, 'mr')} सांगा`, hint: 'तेवढंच बोलून सांगा' } : { title: 'आणखी काम सांगा' };
            case 'answerQuestion':
                // PROPOSED (Marathi) — the question itself is Sathi's own words.
                return { title: 'साथीचा प्रश्न', hint: question };
            case 'correctEntry':
                // PROPOSED (Marathi) — the founder's screen 4.
                return { title: 'जे बदलायचं ते बोलून सांगा', hint: 'उदा. "इथरेल 300 नाही, 350 मिली"' };
            case 'addTodo':
                // PROPOSED (Marathi) — the to-do box's own example (TodoAddForm).
                return { title: 'आठवण बोलून सांगा', hint: 'उदा. "उद्या ठिबकची नळी तपासायची"' };
            case 'attention':
            case 'scheduleDone':
                return { title: 'झालेलं काम सांगा', hint: question }; // PROPOSED (Marathi)
            case 'addToDay':
            default:
                // REUSED — "आणखी सांगा" (PLR-D5 :65); the hint is PROPOSED (Marathi).
                return { title: RESULT_STR.addAnother, hint: 'जे झालं ते बोलून सांगा' };
        }
    },
};

const en: SpeakWords = {
    back: 'Back', // PROPOSED (English)
    wholeFarm: 'Whole farm', // PROPOSED (English)
    band: (purpose, { part, question }) => {
        switch (purpose) {
            case 'fillPart':
                return part ? { title: `Tell the ${partNameIn(part, 'en').toLowerCase()}`, hint: 'Say just that' } : { title: 'Tell more' }; // PROPOSED (English)
            case 'answerQuestion':
                return { title: "Sathi's question", hint: question }; // PROPOSED (English)
            case 'correctEntry':
                return { title: 'Say what should change', hint: 'e.g. "Not 300, 350 ml of Ethrel"' }; // PROPOSED (English)
            case 'addTodo':
                return { title: 'Say the reminder', hint: 'e.g. "Check the drip pipe tomorrow"' }; // PROPOSED (English)
            case 'attention':
            case 'scheduleDone':
                return { title: 'Tell the work done', hint: question }; // PROPOSED (English)
            case 'addToDay':
            default:
                return { title: 'Tell more', hint: 'Say what was done' }; // PROPOSED (English)
        }
    },
};

export const speakWords = (language: string | null | undefined): SpeakWords => (language === 'en' ? en : mr);
