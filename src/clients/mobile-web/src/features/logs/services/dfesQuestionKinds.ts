/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q; founder D-B, 2026-11-21) - what KIND of question a bank key is.
 *
 * The phone's copy of the server's table (`ShramSafal.Domain/Dfes/QuestionKinds.cs`), used only to keep the phone from SELECTING a
 * question the server would refuse. The server decides for itself from the key and never trusts this. A question that states
 * agronomy (what to look for at this stage, a threshold, spray or weather advice) needs the look lines it came from in Shram
 * Safal's published schedule; an unknown key counts as stating agronomy (fail closed), exactly as on the server.
 */
export type QuestionKind =
    | 'gap' | 'stage_confirm' | 'stage_open' | 'stage_look' | 'why_not' | 'followup' | 'learning'
    | 'weather_check_in' | 'safety' | 'weather' | 'unknown';

const AGRONOMY: ReadonlySet<QuestionKind> = new Set<QuestionKind>(['stage_look', 'safety', 'weather', 'unknown']);

/** The kind of the question with this bank key (same rules as the server). */
export function questionKindForKey(questionKey: string | null | undefined): QuestionKind {
    const key = (questionKey ?? '').trim();
    switch (key) {
        case 'stage.look': return 'stage_look';
        case 'stage.open': return 'stage_open';
        case 'stage.confirm_current': return 'stage_confirm';
        case 'weather.severe_care_check': return 'weather_check_in';
        case 'weather.rain_before_spray': return 'weather';
    }
    if (key.startsWith('gap.')) return 'gap';
    if (key.startsWith('followup.')) return 'followup';
    if (key.startsWith('learning.')) return 'learning';
    if (key.startsWith('schedule.')) return 'why_not';
    if (key.startsWith('safety.')) return 'safety';
    return 'unknown';
}

/** Does a question of this kind state agronomy, so that it needs the schedule look lines it came from? */
export const statesAgronomy = (kind: QuestionKind): boolean => AGRONOMY.has(kind);
