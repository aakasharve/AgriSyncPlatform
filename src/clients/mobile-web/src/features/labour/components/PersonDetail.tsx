/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PersonDetail — a worker: one big net number (देय / उचल) and, when a
 * worker's real trust score exists, an info card for it.
 *
 * Decision 4b (2026-07-19, screen honesty): the "उचल द्या"/"पैसे द्या" actions,
 * the विश्वास (trust-graduation) section, and a hardcoded "दैनिक ₹300" line
 * were all pre-backend demo content wired to nothing real — see
 * `SHOW_MONEY_ACTIONS` / `SHOW_TRUST_GRADUATION` below. Hidden via a flag
 * (not deleted) so re-enabling is cheap once each has a real server-side
 * counterpart (advance/settle endpoints; trust-graduation engine).
 */
import React, { useState } from 'react';
import { Star, ShieldCheck, Clock } from 'lucide-react';
import type { LabourData, LabourPerson } from '../labourMock';
import { inr } from '../labourMock';
import { Avatar, BalanceCard, GroupLabel, NameOnlyBadge, HelpNote } from './LabourUiKit';

interface Props {
    data: LabourData;
    personId: string;
    onAdvance: () => void;
    onSettle: () => void;
    onToast: (m: string) => void;
}

/**
 * "उचल द्या" / "पैसे द्या" — both fire a "— नमुना" placeholder toast only;
 * neither writes anything to the server. Showing them lets a farmer believe
 * real cash was recorded when it wasn't — hidden until a real endpoint backs
 * them (mirrors the same fix on `MukadamDetail`).
 */
const SHOW_MONEY_ACTIONS = false;

/**
 * विश्वास द्या (trust-graduation) — promises "25 clean days → auto-approve",
 * but no server-side trust-graduation engine exists yet; granting it here is
 * purely local `useState` that resets on next visit and never actually
 * changes what gets auto-approved. Hidden until that engine ships.
 */
const SHOW_TRUST_GRADUATION = false;

/**
 * विश्वास score — hidden 2026-08-10. See the long note at the render site below:
 * ReliabilityScore returns 100 for every worker because its metrics source
 * returns zeros and zero-logs is scored as a perfect ratio. Flip to `true` only
 * when the score is computed from real work evidence a farmer could be shown.
 */
const SHOW_TRUST_SCORE = false;

/** Preserved unchanged behind `SHOW_TRUST_GRADUATION` — see the flag's doc comment. */
const TrustGraduationSection: React.FC<{ w: LabourPerson; onToast: (m: string) => void }> = ({ w, onToast }) => {
    const [granted, setGranted] = useState(w.access === 'trusted');
    const eligible = (w.daysActive ?? 0) >= 25 && !!w.cleanRecord;

    return (
        <>
            <GroupLabel>विश्वास</GroupLabel>
            {granted ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><ShieldCheck size={18} /></span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-extrabold text-emerald-800">विश्वास दिला</div>
                            <div className="text-[11.5px] text-emerald-700">याच्या नोंदी आपोआप मंजूर होतात — तुम्हाला तपासायची गरज नाही</div>
                        </div>
                    </div>
                    <button type="button" onClick={() => { setGranted(false); onToast('विश्वास काढला — नोंदी पुन्हा तपासाव्या लागतील'); }} className="mt-2.5 text-[11.5px] font-bold text-slate-500 underline">विश्वास काढा</button>
                </div>
            ) : eligible ? (
                <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-emerald-700">शिफारस · recommendation</div>
                    <div className="mt-1 text-[15px] font-bold text-slate-800">{w.name} सांगेल त्यावर विश्वास ठेवायचा?</div>
                    <div className="mt-1 text-[12px] leading-snug text-slate-500">{w.daysActive} दिवस · वाद नाही. विश्वास दिल्यावर याच्या नोंदी <b>आपोआप मंजूर</b> होतील — रोज तपासायची गरज नाही. निर्णय तुमचा.</div>
                    <button type="button" onClick={() => { setGranted(true); onToast('विश्वास दिला ✓ — नोंदी आपोआप मंजूर'); }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-extrabold text-white transition-transform active:scale-[0.98]">
                        <ShieldCheck size={16} /> विश्वास द्या
                    </button>
                </div>
            ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Clock size={18} /></span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] font-bold text-amber-800">सध्या याच्या नोंदी तुमच्याकडे मंजुरीसाठी येतात</div>
                            <div className="text-[11.5px] text-amber-700">{w.daysActive} दिवस झाले · २५ दिवस आणि वाद नाही, मग विश्वास देता येईल</div>
                        </div>
                    </div>
                </div>
            )}
            <HelpNote
                what="याच्या रोजच्या नोंदी तुम्ही तपासायच्या, की आपोआप मंजूर व्हायच्या — हे इथे ठरतं."
                act="सुरुवातीचे दिवस तुम्ही तपासा. २५ दिवस चांगलं काम व वाद नसेल, तेव्हा 'विश्वास द्या'."
                why="'माझा शेत संघ'मध्ये कोणाला नोंद करता येईल ते ठरतं. इथे त्याच्या नोंदींवर विश्वास ठेवायचा का — हे वेगळं."
            />
        </>
    );
};

const PersonDetail: React.FC<Props> = ({ data, personId, onAdvance, onSettle, onToast }) => {
    const w = data.people[personId];

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            <div className="flex items-center gap-3.5 rounded-[26px] border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <Avatar tone={w.tone} initial={w.initial} size="lg" />
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[19px] font-black leading-tight text-slate-800">{w.name} {!w.verified && <NameOnlyBadge />}</div>
                    {/*
                      * TASK 22 (spec: 2026-08-28-labour-v2-release-1) —
                      * this used to read `{daysActive} दिवस काम`
                      * ("N days work"). `daysActive` is computed server-side
                      * (GetLabourDataHandler.cs) as
                      * `farmLocalToday − FarmLocalDay.From(membership.GrantedAtUtc)`
                      * — days since the worker was ADDED to the farm, never
                      * days he actually worked — yet it sat right above his
                      * money as if it were a work record. The number is
                      * real; only the काम label was false, and no honest
                      * relabel word ("since added") exists anywhere in this
                      * template, so this is deletion, not a reword —
                      * reported to the founder rather than inventing copy.
                      *
                      * The bare `{w.trust ? ' · विश्वासार्ह' : ''}` fragment
                      * that lived on the same line is gone too: it asserted
                      * a trust label with no gate at all, unlike the
                      * dedicated विश्वास card below this component, which
                      * Rule 6 (2026-08-10) already hides behind
                      * `SHOW_TRUST_SCORE` because the backing
                      * ReliabilityScore is fabricated (always 100). `Trust`
                      * is hardcoded `null` server-side today, so this never
                      * reached a real farmer — but the mock (used by the dev
                      * preview) would have shown it ungated. Same doctrine,
                      * same flag.
                      */}
                    {SHOW_TRUST_SCORE && w.trust != null && (
                        <div className="mt-1 text-[11px] text-slate-500">विश्वासार्ह</div>
                    )}
                </div>
            </div>

            <BalanceCard
                balance={w.balance}
                settleLabel="पैसे द्या"
                onAdvance={onAdvance}
                onSettle={onSettle}
                showActions={SHOW_MONEY_ACTIONS}
                // Task 1 (P4) — this explanation states the काम झालं figure
                // itself, so it makes no sense (and would need invented copy
                // to caveat) when that figure is unknown. `undefined` lets
                // `BalanceCard` skip the line entirely — the same "leave the
                // gap" treatment as the balance tile it explains.
                //
                // TASK 13 — the line used to end `− उचल ₹0 · आपोआप वजा`
                // ("minus advance ₹0, automatically deducted"). THERE IS NO
                // ADVANCE SYSTEM: `GetLabourDataHandler` hardcodes
                // `advance = 0m` for every worker and no write path anywhere
                // can change it (Stage 4 / LabourAdvance is not built), so the
                // clause promised a mechanism the app does not have.
                // `MukadamDetail` lost the same claim in Task 7b; this was the
                // last one. It is also legally sensitive, which is why the fix
                // is deletion and not rewording:
                // `docs/DECISIONS-BEFORE-FIRST-FARMERS-2026-08-23.md:278-280`
                // flags advance-worked-off-against-days as a bonded-labour
                // pattern under the Bonded Labour System (Abolition) Act,
                // 1976 — removing the promise is subtractive and reduces
                // exposure. The reflow reuses only words already in this
                // template; nothing new was written.
                //
                // The `advance === 0` guard is the same "leave the gap" rule
                // applied to the reflow itself: a two-term line cannot explain
                // a बाकी that subtracts a third term, so when an उचल exists the
                // line is omitted rather than under-explaining the number above
                // it. Unreachable from the real server (advance is always 0m);
                // reachable from `labourMock`, whose people carry demo उचल.
                why={w.balance.recorded === null || w.balance.paid === null || w.balance.advance !== 0
                    ? undefined
                    : `कामाचे पैसे ${inr(w.balance.recorded)} − दिलं ${inr(w.balance.paid)}`}
            />

            {SHOW_TRUST_GRADUATION && (
                <TrustGraduationSection w={w} onToast={onToast} />
            )}

            {/*
              * TRUST SCORE HIDDEN (2026-08-10, founder instruction).
              *
              * This rendered "विश्वास {n} — 30 दिवसांत वाद नाही" as if it were a
              * measured reputation. It is not. The score is computed by
              * ReliabilityScore over GetWorkerMetricsAsync
              * (ShramSafalRepository.cs:1050), which returns all-zero metrics —
              * and the scorer treats logCount30d == 0 as a perfect ratio on all
              * three of its terms. The result is that EVERY worker scores 100,
              * always, regardless of what they did or did not do. The claim
              * "30 दिवसांत वाद नाही" is likewise asserted, never checked.
              *
              * Showing a farmer a fabricated number about a real person is the
              * exact opposite of this product's thesis. Rule 6 of the frozen
              * architectural invariants: no reliability / productivity / trust
              * score may exist unless its underlying evidence exists and is
              * explainable. It does not, so this is hidden — not deleted, so the
              * component returns the moment the evidence is real.
              *
              * The sibling विश्वास-graduation block above is already gated behind
              * SHOW_TRUST_GRADUATION for the same class of reason.
              */}
            {SHOW_TRUST_SCORE && w.trust != null && (
                <div className="flex items-center gap-3 rounded-2xl border border-stone-100 bg-white p-3 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Star size={18} /></span>
                    <span className="text-[17px] font-bold text-stone-700">30 दिवसांत वाद नाही</span>
                </div>
            )}
        </div>
    );
};

export default PersonDetail;
