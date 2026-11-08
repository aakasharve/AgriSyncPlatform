/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * निरीक्षणं व नोंदी — the chosen day's observation notes on the picked plots. Pure.
 *
 * Same source and order as the old Observations panel: the `observations` of the day's logs that are in
 * scope, grouped अडचण → आठवण → निरीक्षण → सल्ला → नोंद. What the redesign adds, all from the record: the
 * time in the farmer's words (`formatFarmerTime`: "सकाळी 9:10"; no time when none was stored), the plot,
 * and who told it (the log's `createdByOperatorId`, named only when the farm's operator list knows him).
 *
 * One text rule: `LogFactory` wraps the reminders it mirrors from tasks in English ("Reminder: … (Extracted
 * from Voice)", "Planned Task: …") and tags them `planned_task` / `manual_task`; for those the farmer's own
 * words (`textRaw`) are shown instead. Every Marathi string is PROPOSED.
 *
 * Lane RF: each note also carries the record it came from (`logId`), who said it the result screen's way (`who`:
 * the name recorded (the phone holder's own name from his profile, lane IT5; never "तुम्ही"), else "अज्ञात" — never a guess) and whether that
 * record is confirmed, so the list can link each note to its recording.
 */
import type { CropProfile, DailyLog, ObservationNote } from '../../../types';
import { formatFarmerTime } from '../../../shared/utils/displayTime';
import { isConfirmed, whoSpoke, type Who, type WhoDeps } from '../../logs/components/voiceResult/resultModel';
import { isLogInScope, type ViewScope } from './reflectSelection';

const FARM_GLOBAL = 'FARM_GLOBAL';
const GROUP_ORDER: readonly ObservationNote['noteType'][] = ['issue', 'reminder', 'observation', 'tip', 'unknown'];

export const NOTE_KIND_LABEL: Record<ObservationNote['noteType'], string> = {
    issue: 'अडचण', reminder: 'आठवण', observation: 'निरीक्षण', tip: 'सल्ला', unknown: 'नोंद',
};
const SEVERITY_LABEL: Partial<Record<NonNullable<ObservationNote['severity']>, string>> = { important: 'महत्त्वाचं', urgent: 'तातडीचं' };
const MACHINE_WRAPPED_TAGS = ['planned_task', 'manual_task'];

export interface NoteItem {
    id: string;
    /** The record (log) the note came from. */
    logId: string;
    /** Who said it, when the page knows how to name the person holding this phone. */
    who?: Who;
    /** The record it came from is confirmed. */
    confirmed: boolean;
    kind: ObservationNote['noteType'];
    kindLabel: string;
    /** `सकाळी 9:10`; empty when the note carries no time. */
    time: string;
    place?: string;
    by?: string;
    text: string;
    severityLabel?: string;
    tags: string[];
}

interface BuildArgs {
    history: readonly DailyLog[];
    dateKey: string;
    scope: ViewScope;
    crops: readonly CropProfile[];
    operatorNameById: Readonly<Record<string, string>>;
    /** Lane RF — names the speaker the result screen's way (a real name; the phone holder's own name too). */
    whoDeps?: WhoDeps;
}

export function buildDayNotes({ history, dateKey, scope, crops, operatorNameById, whoDeps }: BuildArgs): NoteItem[] {
    const plotName = new Map<string, string>();
    for (const c of crops) for (const p of c.plots ?? []) plotName.set(p.id, p.name);

    const items = history
        .filter(l => l.date === dateKey && !l.deletion && isLogInScope(l, scope))
        .flatMap(l => (l.observations ?? []).map(o => ({ o, l, by: l.meta?.createdByOperatorId })))
        .map(({ o, l, by }): NoteItem & { at: string } => {
            const kind = o.noteType && o.noteType in NOTE_KIND_LABEL ? o.noteType : 'unknown';
            const wrapped = (o.tags ?? []).some(t => MACHINE_WRAPPED_TAGS.includes(t));
            return {
                id: o.id,
                logId: l.id,
                ...(whoDeps ? { who: whoSpoke(l, whoDeps) } : {}),
                confirmed: isConfirmed(l),
                kind,
                kindLabel: NOTE_KIND_LABEL[kind],
                time: formatFarmerTime(o.timestamp),
                place: o.plotId === FARM_GLOBAL ? 'पूर्ण शेत' : plotName.get(o.plotId),
                by: by ? operatorNameById[by] : undefined,
                text: (wrapped ? o.textRaw : (o.textCleaned || o.textRaw)) ?? '',
                // lane F1: an unstated severity has no label (never a guessed one).
                severityLabel: o.severity ? SEVERITY_LABEL[o.severity] : undefined,
                tags: (o.tags ?? []).filter(t => !MACHINE_WRAPPED_TAGS.includes(t)),
                at: o.timestamp ?? '',
            };
        });

    return items
        .sort((a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind) || a.at.localeCompare(b.at))
        .map(({ at: _at, ...item }) => item);
}
