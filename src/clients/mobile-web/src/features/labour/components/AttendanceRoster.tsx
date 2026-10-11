/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AttendanceRoster — the people list of the manual हजेरी घ्या screen.
 *
 * KEYED BY FIELD OPERATOR ID, never by a user id (fieldOperatorClient A11/A12):
 * the roster is `fetchFieldOperators(farmId)`, exactly what the voice path
 * (`AttendanceResult`) reads. The screen deliberately does NOT read
 * `LabourData.people` / `LabourData.attendance` — those answer other questions
 * ("who has access", "which operators sit on today's engagements") in a
 * different id space, which is what crashed this screen before.
 *
 * OFFLINE: the last good roster is cached on the device
 * (`fieldOperatorRosterCache`). When the fetch fails the cached names are
 * still listed — with NO claim that they are current — and adding a name is
 * blocked (creation is direct HTTP, and creating against a list we could not
 * read is how a farmer ends up with a second बाळू he already had). With no
 * cache and no network the honest failure banner shows; no roster is invented.
 *
 * "नाव जोडा" mints a real work identity through the existing create path and
 * does NOTHING else: it never attaches the person to an engagement and never
 * marks them. Attribution is a separate opt-in (P9); naming never changes a
 * count (rule 2). Identical names are real, different people (B2): the rows
 * are built with `buildPickerRows`, which never merges them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { Avatar, EmptyState, LoadErrorBanner, LoadingState, NameOnlyBadge } from './LabourUiKit';
import { buildPickerRows, toneForOperatorId } from './FieldOperatorPicker';
import {
    createFieldOperator,
    fetchFieldOperators,
    type FieldOperator,
} from '../data/fieldOperatorClient';
import { readCachedRoster, writeCachedRoster } from '../data/fieldOperatorRosterCache';
import {
    EMPTY_PREFILL,
    sanitizeHoursInput,
    selectionFromPrefill,
    type DayChoice,
    type PersonPrefill,
    type PersonSelection,
} from '../attendanceManual';
import { ATTENDANCE_COPY } from '../attendanceCopy';

const DAY_CHIPS: ReadonlyArray<{ k: DayChoice; label: string; on: string }> = [
    { k: 'Full', label: 'आला', on: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
    { k: 'Half', label: 'अर्धा', on: 'border-amber-300 bg-amber-50 text-amber-700' },
    { k: 'Absent', label: 'आला नाही', on: 'border-rose-300 bg-rose-50 text-rose-600' },
];

const CHIP_BASE = 'min-h-[48px] flex-1 rounded-xl border px-2 py-2 text-[16px] font-extrabold transition-colors';
const CHIP_OFF = 'border-stone-200 bg-white text-stone-500';

interface Props {
    /** undefined = no farm context (the dev preview): nothing is fetched, nothing can be added. */
    farmId: string | undefined;
    /** Only people the farmer has touched on this screen have an entry. */
    selections: Record<string, PersonSelection>;
    /** What the register already holds today, by field operator id. */
    prefills: Record<string, PersonPrefill>;
    onChange: (fieldOperatorId: string, next: PersonSelection) => void;
    onToast: (message: string) => void;
    /** True while a save is in flight — the controls hold still. */
    disabled?: boolean;
}

const AttendanceRoster: React.FC<Props> = ({ farmId, selections, prefills, onChange, onToast, disabled }) => {
    const [roster, setRoster] = useState<FieldOperator[] | null>(() => (farmId ? readCachedRoster(farmId) : null));
    const [loading, setLoading] = useState<boolean>(Boolean(farmId));
    /** True when the LAST fetch failed (the roster, if any, is a cached copy). */
    const [loadFailed, setLoadFailed] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newFullName, setNewFullName] = useState('');
    const [adding, setAdding] = useState(false);
    const addingRef = useRef(false);

    const load = useCallback(async () => {
        if (!farmId) return;
        setLoading(true);
        setLoadFailed(false);
        try {
            const fresh = await fetchFieldOperators(farmId);
            setRoster(fresh);
            writeCachedRoster(farmId, fresh);
        } catch {
            // Honest failure: keep whatever cached copy we already hold, never
            // substitute an invented roster.
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    }, [farmId]);

    useEffect(() => { void load(); }, [load]);

    const rows = useMemo(() => buildPickerRows((roster ?? []).filter((o) => o.isActive)), [roster]);

    const addPerson = async () => {
        const displayName = newName.trim();
        if (!farmId || !displayName || addingRef.current || loadFailed || loading) return;
        addingRef.current = true;
        setAdding(true);
        try {
            const created = await createFieldOperator(farmId, displayName, newFullName.trim() || undefined);
            setRoster((prev) => {
                const next = [...(prev ?? []), created];
                writeCachedRoster(farmId, next);
                return next;
            });
            setNewName('');
            setNewFullName('');
            onToast(`${created.displayName} ✓ जोडलं`);
        } catch {
            onToast('नाव जोडता आलं नाही — पुन्हा प्रयत्न करा');
        } finally {
            addingRef.current = false;
            setAdding(false);
        }
    };

    const addBlocked = !farmId || loadFailed || loading;

    return (
        <div data-testid="attendance-roster" className="flex flex-col gap-2.5">
            {loading && roster === null && <LoadingState label="नावांची यादी येत आहे…" compact />}
            {loadFailed && <LoadErrorBanner onRetry={() => void load()} compact />}

            {!loading && !loadFailed && farmId && rows.length === 0 && (
                <EmptyState
                    icon={<Users size={22} />}
                    title="अजून कुणाचं नाव नाही"
                    subtitle="खाली नाव लिहून पहिलं नाव जोडा."
                />
            )}

            {rows.map((row) => {
                const id = row.operator.id;
                const prefill = prefills[id] ?? EMPTY_PREFILL;
                const sel = selections[id] ?? selectionFromPrefill(prefill);
                const states = sel.day !== null || sel.night;
                const setSel = (patch: Partial<PersonSelection>) => onChange(id, { ...sel, ...patch });
                return (
                    <div key={id} data-testid={`att-row-${id}`}
                        className="flex flex-col gap-2.5 rounded-2xl border border-stone-100 bg-white p-3 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                        <div className="flex items-center gap-3">
                            <Avatar tone={toneForOperatorId(id)} initial={row.operator.displayName.trim().slice(0, 1)} />
                            <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2 text-[19px] font-bold text-stone-800">
                                    {row.operator.displayName}
                                    {row.tag && (
                                        <span className="rounded-lg bg-stone-100 px-2 py-0.5 text-[15px] font-bold text-stone-500">#{row.tag}</span>
                                    )}
                                    {row.ambiguous && !row.fullName && <NameOnlyBadge />}
                                </span>
                                {row.fullName && <span className="mt-0.5 block truncate text-[16px] text-stone-500">{row.fullName}</span>}
                                {row.ambiguous && <span className="mt-0.5 block text-[16px] text-stone-500">सारखं नाव — माणूस वेगळा</span>}
                            </span>
                        </div>

                        <div className="flex gap-1.5" role="group" aria-label={row.operator.displayName}>
                            {DAY_CHIPS.map((chip) => {
                                const on = sel.day === chip.k;
                                return (
                                    <button key={chip.k} type="button" disabled={disabled}
                                        data-testid={`att-day-${chip.k}-${id}`}
                                        aria-pressed={on}
                                        onClick={() => {
                                            if (on) {
                                                // Already on the register: it cannot be un-said here.
                                                if (prefill.day !== null) return;
                                                setSel({ day: null });
                                            } else {
                                                setSel({ day: chip.k });
                                            }
                                        }}
                                        className={`${CHIP_BASE} ${on ? chip.on : CHIP_OFF}`}>
                                        {chip.label}
                                    </button>
                                );
                            })}
                            <button type="button" disabled={disabled}
                                data-testid={`att-night-${id}`}
                                aria-pressed={sel.night}
                                onClick={() => {
                                    // A night already on the register cannot be un-said here.
                                    if (prefill.night) return;
                                    setSel({ night: !sel.night });
                                }}
                                className={`${CHIP_BASE} ${sel.night ? 'border-orange-300 bg-orange-50 text-orange-700' : CHIP_OFF}`}>
                                {ATTENDANCE_COPY.markWord.night}
                            </button>
                        </div>

                        {states && sel.day !== 'Absent' && (
                            <div className="flex gap-2">
                                <label className="flex flex-1 flex-col gap-1 text-[16px] font-bold text-stone-500">
                                    तास
                                    <input type="text" inputMode="decimal" disabled={disabled}
                                        data-testid={`att-hours-${id}`}
                                        value={sel.hours}
                                        onChange={(e) => setSel({ hours: sanitizeHoursInput(e.target.value) })}
                                        className="min-h-[48px] w-full rounded-xl border border-stone-200 bg-white px-3 text-[19px] font-bold text-stone-800 focus:border-emerald-500 focus:outline-none" />
                                </label>
                                <label className="flex flex-1 flex-col gap-1 text-[16px] font-bold text-stone-500">
                                    जादा तास
                                    <input type="text" inputMode="decimal" disabled={disabled}
                                        data-testid={`att-extra-${id}`}
                                        value={sel.extraHours}
                                        onChange={(e) => setSel({ extraHours: sanitizeHoursInput(e.target.value) })}
                                        className="min-h-[48px] w-full rounded-xl border border-stone-200 bg-white px-3 text-[19px] font-bold text-stone-800 focus:border-emerald-500 focus:outline-none" />
                                </label>
                            </div>
                        )}
                    </div>
                );
            })}

            {!formOpen ? (
                <button type="button" data-testid="att-add-open" disabled={disabled || !farmId}
                    onClick={() => setFormOpen(true)}
                    className="flex min-h-[56px] items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-emerald-200 bg-emerald-50 p-3 text-[19px] font-extrabold text-emerald-700 active:scale-[0.98] disabled:opacity-50">
                    <Plus size={20} /> नाव जोडा
                </button>
            ) : (
                <div data-testid="att-add-form" className="flex flex-col gap-2 rounded-2xl border border-stone-100 bg-stone-50 p-3">
                    <div className="px-1 text-[17px] font-bold text-stone-500">नवीन नाव</div>
                    {loadFailed && (
                        <p data-testid="att-add-blocked" className="text-[16px] leading-snug text-stone-500">यादी आली नाही, म्हणून नवीन नाव आत्ता जोडता येणार नाही — आधी पुन्हा प्रयत्न करा.</p>
                    )}
                    <input type="text" value={newName} maxLength={200} disabled={addBlocked || adding}
                        onChange={(e) => setNewName(e.target.value)}
                        aria-label="नवीन माणसाचं नाव" placeholder="नाव" data-testid="att-new-name"
                        className="min-h-[56px] w-full rounded-xl border border-stone-200 bg-white px-3.5 text-[19px] font-bold text-stone-800 placeholder:font-normal placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none disabled:bg-stone-100 disabled:text-stone-400" />
                    <input type="text" value={newFullName} maxLength={200} disabled={addBlocked || adding}
                        onChange={(e) => setNewFullName(e.target.value)}
                        aria-label="पूर्ण नाव किंवा ओळख — ऐच्छिक" placeholder="पूर्ण नाव किंवा ओळख — हवं तर" data-testid="att-new-full-name"
                        className="min-h-[56px] w-full rounded-xl border border-stone-200 bg-white px-3.5 text-[17px] font-semibold text-stone-700 placeholder:font-normal placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none disabled:bg-stone-100 disabled:text-stone-400" />
                    <button type="button" data-testid="att-add-submit"
                        disabled={!newName.trim() || addBlocked || adding}
                        onClick={() => void addPerson()}
                        className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-[18px] font-extrabold text-white transition-transform active:scale-[0.97] disabled:opacity-50">
                        <Plus size={20} strokeWidth={2.6} /> जोडा
                    </button>
                </div>
            )}
        </div>
    );
};

export default AttendanceRoster;
