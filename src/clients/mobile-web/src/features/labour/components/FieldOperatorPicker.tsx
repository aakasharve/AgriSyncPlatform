/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FieldOperatorPicker — Labour V1 Task 13 (spec:
 * 2026-07-13-labour-attendance-approval-design). The farmer-facing surface of
 * the whole Field Operator feature, and the FIRST form control ever added to
 * `features/labour/`.
 *
 * It does exactly two things: add a person, or select an existing one, and
 * attach that person to ONE labour engagement (`labourAssignmentId`, minted
 * client-side by Task 7.3's `ensureLabourAssignmentIds`).
 *
 * ── P9, THE SACRED CONSTRAINT (founder's words: low-friction logging is
 * sacred) ────────────────────────────────────────────────────────────────
 * "आज ८ मजूर होते" must complete its record with ZERO names, ZERO warnings,
 * ZERO wizards, ZERO completion percentages and ZERO nags. Attribution is an
 * OPTIONAL OVERLAY A FARMER OPTS INTO — never a task the app assigns him.
 * Everything this component renders before he opts in is ONE quiet, colour-
 * less, number-free "नावं जोडा · ऐच्छिक" row: no unidentified count, no
 * progress ring, no amber hint, no `role="alert"`, and — deliberately — not
 * even a roster fetch (`fetchFieldOperators` is called on FIRST OPEN, never
 * on render), so the app does not so much as go looking for identities behind
 * a farmer who never asked for them. `FieldOperatorPicker.test.tsx` asserts
 * every one of those, and those assertions are the guard rail: they fail the
 * moment someone adds a nudge.
 *
 * ── ATTRIBUTION NEVER CHANGES HEADCOUNT (Constraint 3) ───────────────────
 * `WorkerCount = 8` with three people attached is still 8. Nothing here
 * displays, implies or computes otherwise: this component never reads,
 * renders or derives a headcount, and never shows an "attached / total"
 * ratio, which is the shape that would quietly turn an overlay back into a
 * completion target.
 *
 * ── B2: IDENTICAL NAMES ARE REAL PEOPLE, NOT DUPLICATES ──────────────────
 * Two Field Operators may share a `DisplayName` AND a `FullName` by design —
 * two real people called बाळू. `buildPickerRows` therefore never merges,
 * hides or auto-picks: it disambiguates with `FullName` when that actually
 * separates them, and otherwise makes the collision VISIBLE (a short id tag
 * plus "सारखं नाव — वेगळी व्यक्ती") so the farmer chooses the person he
 * means. Silently merging two people is the exact identity bug this feature
 * exists to prevent.
 *
 * ── WHY NOT `PersonRow` ──────────────────────────────────────────────────
 * `LabourUiKit.PersonRow` renders a `MoneyLine` off `LabourPerson.balance`.
 * A Field Operator is a bare work identity with NO balance, so reusing it
 * would print a ₹ figure on an identity picker — a fabricated number on a
 * money screen. Every other primitive here IS the kit's (`Avatar`,
 * `GroupLabel`, `EmptyState`, `LoadingState`, `LoadErrorBanner`,
 * `NameOnlyBadge`), so the row is composed from the same parts at the same
 * scale rather than being a parallel invention.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { UserPlus, Check, Plus, Users } from 'lucide-react';
import type { AvatarTone } from '../labourMock';
import { Avatar, EmptyState, GroupLabel, LoadErrorBanner, LoadingState, NameOnlyBadge } from './LabourUiKit';
import {
    attachFieldOperator,
    createFieldOperator,
    fetchFieldOperators,
    type FieldOperator,
} from '../data/fieldOperatorClient';

/** Same six-tone palette the rest of the feature draws avatars from. */
const TONES: AvatarTone[] = ['em', 'bl', 'vi', 'or', 'am', 'rs'];

/**
 * A stable colour per person, derived from the id rather than list position,
 * so बाळू keeps the same avatar colour across fetches — one more thing that
 * tells two same-named people apart.
 */
export const toneForOperatorId = (id: string): AvatarTone =>
    TONES[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TONES.length];

/**
 * The LAST-RESORT discriminator: a short, stable fragment of the operator's
 * own id. Shown ONLY on a row whose name (and full name) do not separate it
 * from another person — never as decoration on an unambiguous row.
 */
export const shortOperatorTag = (id: string): string =>
    id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toLowerCase();

export interface PickerRow {
    operator: FieldOperator;
    /** Rendered when present — it is what tells two same-named people apart. */
    fullName?: string;
    /** True when neither the display name NOR the full name separates this row from another. */
    ambiguous: boolean;
    /** Present only on an `ambiguous` row (see `shortOperatorTag`). */
    tag?: string;
}

/**
 * Task 13.2 — turns the raw roster into rows that can never silently merge
 * two people. Pure and exported so the collision rules are testable without
 * a render.
 *
 * Rules, in order:
 *   1. A name held by exactly one person → plain row (its full name still
 *      shows if it has one; it is information, not disambiguation).
 *   2. A shared name where THIS row's full name is unique inside the group →
 *      resolved by full name; no tag, no collision note.
 *   3. A shared name with no full name, or a full name someone else in the
 *      group also has (B2 permits that exactly) → `ambiguous`: keep both
 *      rows, tag each with its own id fragment, and say so on screen.
 */
export function buildPickerRows(operators: FieldOperator[]): PickerRow[] {
    const byName = new Map<string, FieldOperator[]>();
    operators.forEach((o) => {
        const key = o.displayName.trim();
        const bucket = byName.get(key);
        if (bucket) bucket.push(o);
        else byName.set(key, [o]);
    });

    return operators.map((o) => {
        const group = byName.get(o.displayName.trim()) ?? [o];
        const fullName = o.fullName?.trim() || undefined;
        if (group.length === 1) {
            return { operator: o, fullName, ambiguous: false };
        }
        const sharingFullName = group.filter((g) => (g.fullName?.trim() || undefined) === fullName).length;
        const resolvedByFullName = fullName !== undefined && sharingFullName === 1;
        return {
            operator: o,
            fullName,
            ambiguous: !resolvedByFullName,
            tag: resolvedByFullName ? undefined : shortOperatorTag(o.id),
        };
    });
}

interface Props {
    farmId: string;
    /** The ONE engagement being attributed. Never a daily-log id. */
    labourAssignmentId: string;
    /** The host's existing toast channel — every outcome is reported through it. */
    onToast?: (message: string) => void;
}

const FieldOperatorPicker: React.FC<Props> = ({ farmId, labourAssignmentId, onToast }) => {
    const [open, setOpen] = useState(false);
    const [roster, setRoster] = useState<FieldOperator[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    /**
     * 13.1b — what this engagement now carries, so the farmer can see बाळू
     * landed and does not attach him twice by accident. Session-local BY
     * DESIGN: V1's attribution ledger is write-only (no reputation dashboard,
     * no worker history, no read-back endpoint), and inventing a read model
     * here would be a different project. A re-attach after a reload is
     * harmless anyway — the server is idempotent and answers
     * `alreadyAttached`, which is surfaced honestly below.
     */
    const [attached, setAttached] = useState<FieldOperator[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setLoadFailed(false);
        try {
            setRoster(await fetchFieldOperators(farmId));
        } catch {
            // Honest failure — never a fabricated/empty roster, which would
            // invite the farmer to re-create people he already has.
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    }, [farmId]);

    /** The opt-in. Nothing is fetched before this runs. */
    const openPicker = () => {
        setOpen(true);
        if (roster === null && !loading) void load();
    };

    /** Returns the outcome instead of toasting, so the two call sites (tap a
     *  person / add-then-attach) can each say the true thing. */
    const runAttach = async (operator: FieldOperator): Promise<'ok' | 'already' | 'failed'> => {
        try {
            const result = await attachFieldOperator(farmId, operator.id, labourAssignmentId);
            setAttached((prev) => (prev.some((a) => a.id === operator.id) ? prev : [...prev, operator]));
            return result.alreadyAttached ? 'already' : 'ok';
        } catch {
            return 'failed';
        }
    };

    const pick = async (operator: FieldOperator) => {
        setBusyId(operator.id);
        const outcome = await runAttach(operator);
        setBusyId(null);
        if (outcome === 'failed') onToast?.('जोडता आलं नाही — पुन्हा प्रयत्न करा');
        else if (outcome === 'already') onToast?.(`${operator.displayName} आधीच जोडलेला आहे`);
        else onToast?.(`${operator.displayName} ✓ जोडलं`);
    };

    /**
     * Add-then-attach in one gesture: writing a name here always means "this
     * person worked on this engagement". The two steps are reported
     * separately when they diverge — a created person whose attach failed is
     * still in the list to be tapped, and the farmer is told exactly that
     * rather than being shown a success he did not get.
     */
    const addPerson = async () => {
        const displayName = newName.trim();
        if (!displayName || adding) return;
        setAdding(true);
        let created: FieldOperator;
        try {
            created = await createFieldOperator(farmId, displayName);
        } catch {
            setAdding(false);
            onToast?.('नाव जोडता आलं नाही — पुन्हा प्रयत्न करा');
            return;
        }
        setRoster((prev) => [...(prev ?? []), created]);
        setNewName('');
        const outcome = await runAttach(created);
        setAdding(false);
        if (outcome === 'failed') onToast?.(`${created.displayName} ची नोंद झाली, पण या कामाला लावता आलं नाही — पुन्हा प्रयत्न करा`);
        else onToast?.(`${created.displayName} ✓ जोडलं`);
    };

    // A deactivated identity is not offered for NEW work — attributing fresh
    // work to a retired person is not a thing a farmer can mean. (V1 has no
    // deactivation surface, so today this filters nothing; it is one line
    // that keeps the picker correct the day one exists.)
    const rows = useMemo(() => buildPickerRows((roster ?? []).filter((o) => o.isActive)), [roster]);
    const attachedIds = useMemo(() => new Set(attached.map((a) => a.id)), [attached]);
    const busy = busyId !== null || adding;

    return (
        <div className="mt-3" data-testid="fo-picker">
            {attached.length > 0 && (
                <div data-testid="fo-picker-attached" className="mb-2 flex flex-wrap items-center gap-1.5">
                    {attached.map((a) => (
                        <span
                            key={a.id}
                            data-testid={`fo-attached-${a.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[16px] font-bold text-emerald-700"
                        >
                            <Check size={15} strokeWidth={3} /> {a.displayName}
                        </span>
                    ))}
                </div>
            )}

            {!open ? (
                /*
                 * THE OPT-IN, and the only thing a headcount-only log ever
                 * shows. Deliberately the quietest control on the card:
                 * stone on stone, below मंजूर/शंका so it can never read as a
                 * step before approving, carrying no number of any kind and
                 * no urgency colour. "ऐच्छिक" (optional) is stated on the
                 * control itself so the farmer never has to wonder whether
                 * he is being asked for something.
                 */
                <button
                    type="button"
                    data-testid="fo-picker-trigger"
                    onClick={openPicker}
                    className="flex min-h-[56px] w-full items-center gap-2.5 rounded-xl border border-stone-100 bg-stone-50 px-3.5 py-3 text-left transition-transform active:scale-[0.99]"
                >
                    <UserPlus size={20} className="flex-shrink-0 text-stone-400" />
                    <span className="flex-1 text-[17px] font-bold text-stone-600">{attached.length ? 'आणखी नाव जोडा' : 'नावं जोडा'}</span>
                    <span className="flex-shrink-0 rounded-lg bg-white px-2 py-1 text-[15px] font-bold text-stone-400">ऐच्छिक</span>
                </button>
            ) : (
                <div data-testid="fo-picker-panel" className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                    {/* Constraint 3, said out loud: attaching a name does not
                        touch the number the farmer reported. */}
                    <p className="text-[16px] leading-snug text-stone-600">कोण काम करत होतं ते इथे नोंदवता येतं. मजुरांची संख्या यानं बदलत नाही.</p>

                    <GroupLabel>माणूस निवडा</GroupLabel>
                    {loading && <LoadingState label="माणसं आणत आहोत…" compact />}
                    {loadFailed && <LoadErrorBanner onRetry={() => void load()} compact />}
                    {!loading && !loadFailed && rows.length === 0 && (
                        <EmptyState
                            icon={<Users size={22} />}
                            title="अजून कुणाचं नाव नाही"
                            subtitle="खाली नाव लिहून पहिलं नाव जोडा."
                        />
                    )}
                    {!loading && !loadFailed && rows.map((row) => {
                        const isAttached = attachedIds.has(row.operator.id);
                        return (
                            <button
                                key={row.operator.id}
                                type="button"
                                data-testid={`fo-row-${row.operator.id}`}
                                disabled={isAttached || busy}
                                onClick={() => void pick(row.operator)}
                                className={`mt-1.5 flex min-h-[68px] w-full items-center gap-3 rounded-[16px] border bg-white p-3 text-left transition-transform active:scale-[0.98] disabled:active:scale-100 ${isAttached ? 'border-emerald-200' : 'border-stone-100'}`}
                            >
                                <Avatar tone={toneForOperatorId(row.operator.id)} initial={row.operator.displayName.trim().slice(0, 1)} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-2 text-[19px] font-bold text-stone-800">
                                        {row.operator.displayName}
                                        {row.tag && (
                                            <span data-testid={`fo-tag-${row.operator.id}`} className="rounded-lg bg-stone-100 px-2 py-0.5 text-[15px] font-bold text-stone-500">#{row.tag}</span>
                                        )}
                                        {row.ambiguous && !row.fullName && <NameOnlyBadge />}
                                    </span>
                                    {row.fullName && <span className="mt-0.5 block truncate text-[16px] text-stone-500">{row.fullName}</span>}
                                    {row.ambiguous && <span className="mt-0.5 block text-[16px] text-stone-500">सारखं नाव — वेगळी व्यक्ती</span>}
                                </span>
                                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${isAttached ? 'bg-emerald-50 text-emerald-600' : 'bg-stone-100 text-stone-400'}`}>
                                    {isAttached ? <Check size={20} strokeWidth={3} /> : <Plus size={20} strokeWidth={2.6} />}
                                </span>
                            </button>
                        );
                    })}

                    <GroupLabel>नवीन नाव</GroupLabel>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            // Matches ssf.field_operators.display_name exactly, so
                            // the field never truncates something the server would
                            // have accepted.
                            maxLength={200}
                            aria-label="नवीन माणसाचं नाव"
                            placeholder="नाव"
                            data-testid="fo-new-name"
                            className="min-h-[56px] min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3.5 text-[19px] font-bold text-stone-800 placeholder:font-normal placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                            type="button"
                            data-testid="fo-add"
                            disabled={!newName.trim() || busy}
                            onClick={() => void addPerson()}
                            className="flex min-h-[56px] flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-[18px] font-extrabold text-white transition-transform active:scale-[0.97] disabled:opacity-50"
                        >
                            <Plus size={20} strokeWidth={2.6} /> जोडा
                        </button>
                    </div>

                    <button
                        type="button"
                        data-testid="fo-picker-close"
                        onClick={() => setOpen(false)}
                        className="mt-3 flex min-h-[52px] w-full items-center justify-center rounded-xl border border-stone-200 bg-white text-[17px] font-bold text-stone-500"
                    >
                        बंद करा
                    </button>
                </div>
            )}
        </div>
    );
};

export default FieldOperatorPicker;
