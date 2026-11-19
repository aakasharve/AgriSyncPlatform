/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * disciplineRecognition — pure copy builder for the DFES recognition line.
 * Warm, never-red Marathi acknowledgement driven by the engagement projection.
 * spec: dfes-companion-2026-07-11
 */
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';

const marathiDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

export function toMarathiNumber(value: number): string {
    return String(Math.max(0, Math.trunc(value)))
        .split('')
        .map((char) => (/\d/.test(char) ? marathiDigits[Number(char)] : char))
        .join('');
}

/**
 * PLR-D5 (lane AI-1) — the word नोंद is kept off the result screen, where this line shows: he TOLD Sathi his
 * work, he did not "make an entry". Marathi in either app language (the farmer's log screens carry no English),
 * so there is no English twin.
 */
export function buildRecognitionLine(engagement: FarmerEngagementDto): string | null {
    const streak = engagement.currentStreak;
    if (streak >= 2) {
        return `सलग ${toMarathiNumber(streak)} दिवस काम सांगितलं! छान सातत्य ठेवलंत.`; // PROPOSED (Marathi)
    }
    if (streak === 1) {
        return 'आजचं काम सांगितलं. उद्याही भेटूया.'; // PROPOSED (Marathi)
    }
    // spec: plr-d10 lane HONESTY-1 (H7; P4) - the "पुन्हा सुरुवात करूया" (start again) variant is gone. This line shows right after he
    // told his work, from the server's snapshot, which is read once when the screen opens and can miss the record he just made - so a
    // streak of 0 here is usually STALE, and "start again" would tell him he lost a chain he did not lose. No streak, no line.
    return null;
}
