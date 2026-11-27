/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM) - the words of "kinds of work he may record". One language at a time (Marathi
 * mode: Marathi only; English mode: English only). A kind's own name is the result screen's part name (REUSED, `partNameIn`); every other line is
 * PROPOSED, with its English twin.
 */
import type { WorkKind } from '../../core/session/workKinds';
import type { PartKey } from '../logs/components/voiceResult/resultModel';
import { partNameIn } from '../logs/components/voiceResult/partNames';

/** The result screen's part for each kind (one vocabulary with the record). */
export const PART_OF_KIND: Readonly<Record<WorkKind, PartKey>> = {
    cropActivities: 'crop',
    irrigation: 'irrigation',
    inputs: 'inputs',
    labour: 'labour',
    machinery: 'machinery',
    activityExpenses: 'expense',
};

/** A kind's name in his language: पीक काम, पाणी, औषध / खत, मजूर, यंत्र, खर्च (REUSED part names). */
export const kindName = (kind: WorkKind, language: string | null | undefined): string => partNameIn(PART_OF_KIND[kind], language);

const kindNames = (kinds: readonly WorkKind[], language: string | null | undefined): string => kinds.map(k => kindName(k, language)).join(', ');

export interface WorkKindWords {
    /** CTO ruling Q3 A: "‹kind› नोंदवण्याची परवानगी नाही — मालकाला सांगा". */
    notAllowedLine: (kinds: readonly WorkKind[]) => string;
    /** The rest of the record was saved; his recording is kept with it. */
    restSavedLine: string;
    /** A recording that held ONLY such kinds: nothing was saved, his recording is kept. */
    nothingSavedTitle: string;
    keptLine: string;
}

const mr = (language: string | null | undefined): WorkKindWords => ({
    notAllowedLine: kinds => `${kindNames(kinds, language)} नोंदवण्याची परवानगी नाही — मालकाला सांगा`, // PROPOSED (Marathi) - CTO ruling Q3 A
    restSavedLine: 'बाकी काम जतन झालं. तुमचा आवाज नोंदीसोबत आहे.', // PROPOSED (Marathi)
    nothingSavedTitle: 'हे जतन झालं नाही', // PROPOSED (Marathi)
    keptLine: 'जे बोललात ते फोनमध्ये ठेवलं आहे — काही हरवत नाही.', // REUSED - checkSaveWords.keptNote
});

const en = (language: string | null | undefined): WorkKindWords => ({
    notAllowedLine: kinds => `You may not record ${kindNames(kinds, language)} — tell the owner`, // PROPOSED (English)
    restSavedLine: 'The rest of the work was saved. Your voice is kept with the record.', // PROPOSED (English)
    nothingSavedTitle: 'This was not saved', // PROPOSED (English)
    keptLine: 'What you said is kept on this phone — nothing is lost.', // REUSED - checkSaveWords.keptNote (English)
});

/** English only for 'en'; every other language reads Marathi. */
export const workKindWords = (language: string | null | undefined): WorkKindWords => (language === 'en' ? en(language) : mr(language));
