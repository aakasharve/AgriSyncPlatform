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

export function buildRecognitionLine(engagement: FarmerEngagementDto): string {
    const streak = engagement.currentStreak;
    if (streak >= 2) {
        return `सलग ${toMarathiNumber(streak)} दिवस नोंद! छान सातत्य ठेवलंत.`;
    }
    if (streak === 1) {
        return 'आजची नोंद झाली. उद्याही भेटूया.';
    }
    return 'पुन्हा सुरुवात करूया — आजची नोंद मोलाची आहे.';
}
