/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-57 = 1A, 2026-10-31) — "बदला" on a हजेरी-door
 * record opens THAT DAY in the हजेरी वही: the two days before it for context, the chosen day highlighted, and each
 * person's cell tapped हजर → अर्धा → नाही; "जतन करा" writes one `attendance.mark` per person he changed (queued on the
 * phone, shown weaker until the server has it — P10). The date at the top opens the calendar: ANY earlier day, never a
 * future one (founder: "add a calendar … so that all the previous records will get captured").
 *
 *   - Names stay what they are (never typed or changed here), and nothing is summed: there is no "N जण" total — a mark is
 *     about one person, never a count of the day (doctrine P7).
 *   - Untouched is not absent (rule 4): a person he did not tap gets no mark.
 *   - SAFE DAYS ONLY (`attendanceDay.ts`): a mark on a day whose marks are not all on screen silently amends the stored fact,
 *     so a past day is changed only when the open register is the server's current all-time answer in the owner's view;
 *     otherwise the day is shown and says plainly why it cannot be changed now. Today always can.
 */
import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Clock } from 'lucide-react';
import { cellDayClass } from './HajeriLedger';
import { t as translate } from '../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../sync/status/syncHonestyState';
import type { LabourData, LedgerCell } from '../labour.types';
import type { DayChoice } from '../attendanceManual';
import type { ManualAttendanceMark } from './Attendance';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { DayPickSheet } from '../../logs/components/dayPick/DayPickSheet';
import { addDayKeys, dayFull, dayRel, dayShort } from '../../logs/components/dayPick/dayWords';
import { readCachedRoster } from '../data/fieldOperatorRosterCache';

const SANS = "'Noto Sans Devanagari', sans-serif";

const WORDS = {
    mr: {
        // PROPOSED (Marathi) — the working phones (1A), unless REUSED.
        note: 'हिरवी रांग = निवडलेला दिवस. चौकटीवर दाबा: हजर → अर्धा → नाही. वरची तारीख दाबून कोणताही मागचा दिवस उघडा.',
        name: 'नाव',
        Full: 'हजर', Half: 'अर्धा', Absent: 'नाही',
        save: 'जतन करा',
        nothing: 'काहीच बदललं नाही',
        calNote: 'कोणताही मागचा दिवस निवडा — त्या दिवसाची हजेरी उघडेल. ठिपका = त्या दिवशी नोंद आहे.',
        notSafe: 'हा दिवस आत्ता बदलता येत नाही: या फोनवर त्या दिवसाची पूर्ण हजेरी नाही. इंटरनेट असताना पुन्हा उघडा.',
        notAllowed: 'हजेरी बदलायची सोय फक्त शेतमालक आणि त्यांनी सोपवलेल्यांना आहे.',
        nobody: 'अजून कोणाचंही नाव हजेरीच्या यादीत नाही.',
        saveFirst: 'आधी जतन करा',
    },
    en: {
        // PROPOSED (English)
        note: 'Green column = the chosen day. Tap a cell: Present → Half → Absent. Tap the date at the top to open any earlier day.',
        name: 'Name',
        Full: 'Present', Half: 'Half', Absent: 'Absent',
        save: 'Save',
        nothing: 'Nothing changed',
        calNote: "Choose any earlier day — that day's attendance opens. A dot = something is recorded that day.",
        notSafe: "This day cannot be changed now: this phone does not hold that day's full attendance. Open it again when online.",
        notAllowed: 'Only the farm owner and the people the owner trusts can change attendance.',
        nobody: 'No one is on the attendance list yet.',
        saveFirst: 'Save first',
    },
} as const;

const NEXT: Record<DayChoice, DayChoice> = { Full: 'Half', Half: 'Absent', Absent: 'Full' };
const FROM_CELL: Record<string, DayChoice> = { full: 'Full', half: 'Half', absent: 'Absent' };
const cellChoice = (c: LedgerCell | null | undefined): DayChoice | null => (c?.day ? FROM_CELL[c.day] ?? null : null);
const TONE: Record<DayChoice, string> = {
    Full: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    Half: 'bg-amber-100 text-amber-800 border-amber-300',
    Absent: 'bg-slate-100 text-slate-500 border-slate-200',
};

interface Person { id: string; name: string; cells: (LedgerCell | null)[] }

export interface HajeriDayEditProps {
    data: LabourData;
    farmId?: string;
    /** The day open (`yyyy-MM-dd`). */
    day: string;
    onDay: (day: string) => void;
    /** He may change marks at all (the server's own rule for this person). */
    allowed: boolean;
    /** This day's marks are all on screen (today, or the server's current all-time owner register). */
    safe: boolean;
    /** Queue the marks; resolves once they are on the phone, rejects when they were not (he can press again). */
    onSave: (marks: ManualAttendanceMark[], day: string) => Promise<void>;
    onToast: (message: string) => void;
    /** Injectable for tests. */
    todayKey?: string;
}

export const HajeriDayEdit: React.FC<HajeriDayEditProps> = ({ data, farmId, day, onDay, allowed, safe, onSave, onToast, todayKey = getDateKey() }) => {
    const language = useOptionalLanguage()?.language;
    const w = language === 'en' ? WORDS.en : WORDS.mr;
    const cols = [addDayKeys(day, -2), addDayKeys(day, -1), day];
    const people = useMemo<Person[]>(() => {
        const idx = [addDayKeys(day, -2), addDayKeys(day, -1), day].map(k => data.ledger.days.indexOf(k));
        const seen = new Set<string>();
        const out: Person[] = [];
        for (const r of data.ledger.rows) {
            if (seen.has(r.fieldOperatorId)) continue;
            seen.add(r.fieldOperatorId);
            out.push({ id: r.fieldOperatorId, name: r.name, cells: idx.map(i => (i >= 0 ? r.cells[i] ?? null : null)) });
        }
        // People on the farm's list with nothing recorded in the register yet (the offline-cached list).
        for (const op of (farmId ? readCachedRoster(farmId) ?? [] : [])) {
            if (!op.isActive || seen.has(op.id)) continue;
            seen.add(op.id);
            out.push({ id: op.id, name: op.displayName, cells: [null, null, null] });
        }
        return out;
    }, [data.ledger, farmId, day]);
    const [draft, setDraft] = useState<Record<string, DayChoice>>({});
    const [draftDay, setDraftDay] = useState(day);
    if (draftDay !== day) { setDraftDay(day); setDraft({}); }
    const [calOpen, setCalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const editable = allowed && safe;

    const marks: ManualAttendanceMark[] = people.flatMap(p => {
        const chosen = draft[p.id];
        return chosen && chosen !== cellChoice(p.cells[2]) ? [{ fieldOperatorId: p.id, dayMark: chosen }] : [];
    });
    const dirty = marks.length > 0;
    /** He changed this person's cell on this screen (not saved yet). */
    const changed = (p: Person): boolean => !!draft[p.id] && draft[p.id] !== cellChoice(p.cells[2]);
    const onPhoneShown = people.some(p => p.cells.some(c => c?.unsynced));
    const daysWithMarks = new Set(data.ledger.days.filter((_, i) => data.ledger.rows.some(r => r.cells[i] !== null)));

    const save = async () => {
        if (!dirty) { onToast(w.nothing); return; }
        if (saving) return;
        setSaving(true);
        try {
            await onSave(marks, day);
            setDraft({});
        } catch {
            // the host has already said what went wrong; the taps stay so he can press again
        } finally {
            setSaving(false);
        }
    };

    const headCell = 'flex h-8 items-center justify-center text-[12px] font-extrabold';
    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2" style={{ fontFamily: SANS }} data-testid="hajeri-day">
            <button type="button" onClick={() => setCalOpen(true)} data-testid="hajeri-day-date"
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-2 border-emerald-400 bg-white text-[17px] font-extrabold text-emerald-900">
                <CalendarDays size={20} aria-hidden="true" />{dayFull(day, language)}<ChevronDown size={18} aria-hidden="true" />
            </button>
            <p className="m-0 text-[13.5px] font-bold leading-snug text-stone-600">{w.note}</p>
            {!allowed && <p className="m-0 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[14px] font-bold text-amber-900" data-testid="hajeri-day-not-allowed">{w.notAllowed}</p>}
            {allowed && !safe && <p className="m-0 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[14px] font-bold text-amber-900" data-testid="hajeri-day-not-safe">{w.notSafe}</p>}

            {people.length === 0 ? (
                <p className="m-0 rounded-xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="hajeri-day-nobody">{w.nobody}</p>
            ) : (
                <div className="grid grid-cols-[1fr_repeat(3,64px)] gap-1 rounded-2xl border border-stone-200 bg-white p-2" data-testid="hajeri-day-grid">
                    <span className={`${headCell} justify-start pl-1 text-stone-700`}>{w.name}</span>
                    {cols.map((k, i) => (
                        <span key={k} className={`${headCell} rounded-lg ${i === 2 ? 'bg-emerald-600 text-white' : 'text-stone-500'}`} data-testid={`hajeri-day-head-${k}`}>{i === 2 ? dayRel(k, todayKey, language) : dayShort(k, language)}</span>
                    ))}
                    {people.map(p => {
                        const now = draft[p.id] ?? cellChoice(p.cells[2]);
                        return (
                            <React.Fragment key={p.id}>
                                <span className="flex min-h-[44px] items-center truncate pl-1 text-[14.5px] font-extrabold text-stone-800" data-testid={`hajeri-day-name-${p.id}`}>{p.name}</span>
                                {[0, 1].map(i => {
                                    const c = cellChoice(p.cells[i]);
                                    // Lane OF fix 1 (M7, P10): the वही's own look — a mark only on this phone is drawn weaker.
                                    return (
                                        <span key={i} className={`relative flex min-h-[44px] items-center justify-center rounded-lg text-[12.5px] font-extrabold ${cellDayClass(p.cells[i] ?? null)}`}>
                                            {p.cells[i]?.unsynced && <Clock size={8} data-testid="hajeri-day-pending" className="absolute left-0.5 top-0.5 text-amber-600" aria-hidden="true" />}
                                            {c ? w[c] : ''}
                                        </span>
                                    );
                                })}
                                <button type="button" disabled={!editable || saving} data-testid={`hajeri-day-cell-${p.id}`} data-mark={now ?? 'none'}
                                    onClick={() => setDraft(d => ({ ...d, [p.id]: now ? NEXT[now] : 'Full' }))}
                                    className={`relative flex min-h-[44px] items-center justify-center rounded-lg text-[13px] font-extrabold ring-2 ring-emerald-400 disabled:ring-0 ${changed(p) ? `border-2 ${TONE[now as DayChoice]} outline outline-2 outline-emerald-700` : cellDayClass(p.cells[2] ?? null)}`}>
                                    {!changed(p) && p.cells[2]?.unsynced && <Clock size={8} data-testid="hajeri-day-pending" className="absolute left-0.5 top-0.5 text-amber-600" aria-hidden="true" />}
                                    {now ? w[now] : '+'}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}

            {onPhoneShown && (
                <p className="m-0 flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-700" data-testid="hajeri-day-on-phone">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md border border-dashed border-amber-300 bg-white text-amber-600"><Clock size={11} aria-hidden="true" /></span>
                    {translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, language === 'en' ? 'en' : 'mr')}
                </p>
            )}

            {editable && people.length > 0 && (
                <button type="button" onClick={() => void save()} disabled={saving} data-testid="hajeri-day-save"
                    className={`min-h-[56px] w-full rounded-2xl text-[18px] font-extrabold text-white ${dirty ? 'bg-emerald-700' : 'bg-stone-300'}`}>
                    {w.save}
                </button>
            )}

            {calOpen && (
                <DayPickSheet value={day} todayKey={todayKey} note={w.calNote} hasRecords={k => daysWithMarks.has(k)}
                    onClose={() => setCalOpen(false)}
                    onPick={k => {
                        setCalOpen(false);
                        if (dirty && k !== day) { onToast(w.saveFirst); return; }
                        onDay(k);
                    }} />
            )}
        </div>
    );
};

export default HajeriDayEdit;
