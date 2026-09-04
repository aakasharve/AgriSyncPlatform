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
 * Two things make that resolvable rather than merely safe (fix round 1):
 *   - The add form carries an OPTIONAL second field, "पूर्ण नाव / ओळख".
 *     Without it every operator this UI can create has `fullName = null`
 *     (there is no rename client by design, and the seeder creates none), so
 *     the disambiguate-by-full-name branch was unreachable in production and
 *     every real collision fell through to a Latin-script id fragment a
 *     Marathi-reading farmer cannot use. It stays optional: a farmer who
 *     types only "बाळू" must still succeed with zero friction (P9).
 *   - `buildPickerRows` GROUPS same-named people adjacently. The roster
 *     arrives ordered by `CreatedAtUtc`, so two बाळू created weeks apart
 *     would otherwise sit far apart in the list and the collision would only
 *     be discoverable by scrolling. A collision has to be visible at the
 *     moment of choosing to be worth anything.
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
 * two people, ordered so a collision is impossible to miss. Pure and exported
 * so the collision rules are testable without a render.
 *
 * ORDER: same-named people are emitted ADJACENTLY. Name groups keep the
 * order in which their FIRST member appeared in the roster, and members keep
 * roster order inside a group, so nothing jumps around unnecessarily — the
 * only movement is a later बाळू being pulled up beside the earlier one. The
 * server orders by `CreatedAtUtc` (`ShramSafalRepository.GetFieldOperators
 * ForFarmAsync`), which would otherwise scatter a collision across the list.
 *
 * Rules, in order:
 *   1. A name held by exactly one person → plain row (its full name still
 *      shows if it has one; it is information, not disambiguation).
 *   2. A shared name where THIS row's full name is unique inside the group →
 *      resolved by full name; no tag, no collision note. Reachable in
 *      production because the add form offers an optional full-name field.
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

    // `Map` iterates in insertion order, which is what makes the grouping
    // stable and predictable rather than a re-sort.
    return [...byName.values()].flatMap((group) => group.map((o) => {
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
    }));
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
    /**
     * OPTIONAL. The one thing a farmer can write that actually tells two
     * बाळूs apart — a surname, a village, "मोठा बाळू", anything human. Blank
     * is a first-class answer: `createFieldOperator` omits the field entirely
     * rather than posting an empty string, and a name-only add is exactly as
     * fast as it was before this field existed.
     */
    const [newFullName, setNewFullName] = useState('');

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
        // `loadFailed` blocks this too: creating against a roster we could not
        // read is how a farmer ends up with a second बाळू he already had.
        if (!displayName || adding || loadFailed) return;
        setAdding(true);
        let created: FieldOperator;
        try {
            created = await createFieldOperator(farmId, displayName, newFullName.trim() || undefined);
        } catch {
            setAdding(false);
            onToast?.('नाव जोडता आलं नाही — पुन्हा प्रयत्न करा');
            return;
        }
        setRoster((prev) => [...(prev ?? []), created]);
        setNewName('');
        setNewFullName('');
        const outcome = await runAttach(created);
        setAdding(false);
        if (outcome === 'failed') onToast?.(`${created.displayName}चं नाव यादीत आलं, पण या कामाला लावता आलं नाही — पुन्हा प्रयत्न करा`);
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
                    <span className="flex-shrink-0 rounded-lg bg-white px-2 py-1 text-[15px] font-bold text-stone-400">हवं तर</span>
                </button>
            ) : (
                <div data-testid="fo-picker-panel" className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                    {/* Constraint 3, said out loud: attaching a name does not
                        touch the number the farmer reported. */}
                    <p className="text-[16px] leading-snug text-stone-600">कोण काम करत होतं ते इथे सांगता येतं. किती जण होते, ते यानं बदलत नाही.</p>

                    <GroupLabel>माणूस निवडा</GroupLabel>
                    {loading && <LoadingState label="नावांची यादी येत आहे…" compact />}
                    {loadFailed && <LoadErrorBanner onRetry={() => void load()} compact />}
                    {!loading && !loadFailed && rows.length === 0 && (
                        /*
                         * INSTRUCTIONAL EXAMPLES (founder, 2026-08-14: "less
                         * opacity worker names so that they can mention their
                         * worker names"). An empty list does not tell a
                         * first-time farmer WHAT belongs in it; three faint
                         * names do, with no instruction to read. There is
                         * deliberately NO lead word — an earlier draft opened
                         * with "उदा." and the founder cut it.
                         *
                         * §B6 — DEMO PEOPLE ARE UI EXAMPLES ONLY, ZERO FAKE
                         * `FieldOperator` ROWS. These are three string
                         * literals. Nothing fetches, creates, attaches or
                         * stores them, so `ssf.field_operators` stays at 0
                         * because of them; and they can never be mistaken for
                         * someone selectable, because there is nothing to
                         * select — no avatar, no card, no `+`, no tap target,
                         * not a `<button>` and no handler, so `P5` (a control
                         * that looks functional and is not) cannot apply.
                         * `aria-hidden` because announcing three people who
                         * do not exist is worse than silence. The guard on
                         * this branch already excludes loading and load
                         * failure, so they show ONLY while the farm is
                         * knowably empty, and vanish the moment a real roster
                         * — or the farmer's own first person — arrives.
                         *
                         * They ride `EmptyState`'s trailing slot rather than a
                         * new prop, so the honest "अजून कुणाचं नाव नाही"
                         * heading stays directly above them and the shared kit
                         * is untouched.
                         */
                        <EmptyState
                            icon={<Users size={22} />}
                            title="अजून कुणाचं नाव नाही"
                            subtitle="खाली नाव लिहून पहिलं नाव जोडा."
                            action={
                                <span
                                    aria-hidden="true"
                                    data-testid="fo-example-names"
                                    // Name-sized and name-weighted, because the lesson is
                                    // WHERE a name goes — but at 35% ink (~2.1:1 on white),
                                    // fainter than this component's own placeholders
                                    // (stone-400, ~2.5:1). The faintness IS the design; it
                                    // is not a contrast defect to be "fixed".
                                    className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[19px] font-bold text-stone-800/35"
                                >
                                    <span>सुनीता</span>
                                    <span>संदीप</span>
                                    <span>विलास</span>
                                </span>
                            }
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
                                    {row.ambiguous && <span className="mt-0.5 block text-[16px] text-stone-500">सारखं नाव — माणूस वेगळा</span>}
                                </span>
                                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${isAttached ? 'bg-emerald-50 text-emerald-600' : 'bg-stone-100 text-stone-400'}`}>
                                    {isAttached ? <Check size={20} strokeWidth={3} /> : <Plus size={20} strokeWidth={2.6} />}
                                </span>
                            </button>
                        );
                    })}

                    <GroupLabel>नवीन नाव</GroupLabel>
                    {/*
                      * The honest-failure banner above exists to stop the
                      * farmer re-creating someone he already has. Leaving this
                      * form live underneath it would hand him the exact
                      * mistake the banner warns about, so creation is closed
                      * until the list actually loads — and it says why, rather
                      * than going quietly grey.
                      */}
                    {loadFailed && (
                        <p data-testid="fo-add-blocked" className="mb-2 text-[16px] leading-snug text-stone-500">यादी आली नाही, म्हणून नवीन नाव आत्ता जोडता येणार नाही — आधी पुन्हा प्रयत्न करा.</p>
                    )}
                    <div className="flex flex-col gap-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            // Matches ssf.field_operators.display_name exactly, so
                            // the field never truncates something the server would
                            // have accepted.
                            maxLength={200}
                            disabled={loadFailed}
                            aria-label="नवीन माणसाचं नाव"
                            placeholder="नाव"
                            data-testid="fo-new-name"
                            className="min-h-[56px] w-full rounded-xl border border-stone-200 bg-white px-3.5 text-[19px] font-bold text-stone-800 placeholder:font-normal placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none disabled:bg-stone-100 disabled:text-stone-400"
                        />
                        {/*
                          * The disambiguator, and the ONLY one a farmer can
                          * actually read back. Optional by design (P9): the
                          * button below is enabled on the name alone, so
                          * "बाळू" + जोडा is still a two-tap add.
                          */}
                        <input
                            type="text"
                            value={newFullName}
                            onChange={(e) => setNewFullName(e.target.value)}
                            maxLength={200}
                            disabled={loadFailed}
                            aria-label="पूर्ण नाव किंवा ओळख — ऐच्छिक"
                            placeholder="पूर्ण नाव किंवा ओळख — हवं तर"
                            data-testid="fo-new-full-name"
                            className="min-h-[56px] w-full rounded-xl border border-stone-200 bg-white px-3.5 text-[17px] font-semibold text-stone-700 placeholder:font-normal placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none disabled:bg-stone-100 disabled:text-stone-400"
                        />
                        <button
                            type="button"
                            data-testid="fo-add"
                            disabled={!newName.trim() || busy || loadFailed}
                            onClick={() => void addPerson()}
                            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-[18px] font-extrabold text-white transition-transform active:scale-[0.97] disabled:opacity-50"
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
