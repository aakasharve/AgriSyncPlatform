/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5; founder D-26). The PRIMARY owner's invite
 * builder: owner defines first, delivery comes second.
 *   1. Who this person is (सहमालक · कुटुंब · मुकादम · कामगार) — a label grants nothing; it only pre-fills the switches.
 *   2. The three D-26 questions: which plots (the MU-4 plot picker), what responsibility (the label's starting set), can
 *      they see money — and "एक एक परवानगी बदला" opens the team card's own switches (lane 2b) over the SAME grant.
 *   3. Optional: his name, his mobile (named + his proven number = in at once), a worker from the हजेरी list (lane WID).
 *   4. Delivery: "समोर आहेत — QR दाखवा" or "दूर आहेत — लिंक पाठवा" — both carry the SAME invitation (its code and link).
 * The body sent is exactly the grant on the screen (`createBody`); the server's answer is what is then shown.
 */
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link2, QrCode, X } from 'lucide-react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { AUTHORITY } from '../../core/session/farmAuthorities';
import { AuthoritySwitches } from '../profile/team/AuthoritySwitches';
import { PlotScopePicker } from '../profile/team/PlotScopePicker';
import type { FarmPlot } from '../profile/team/useFarmPlots';
import { invitationCopy } from './invitationCopy';
import {
    INVITATION_LABELS,
    createBody,
    dayOf,
    displayInvitationCode,
    holds,
    notInForce,
    presetGrant,
    readMobile,
    withAuthorities,
    withLabel,
    withMoney,
    withPlots,
    type InviteGrant,
} from './invitationModel';
import {
    createInvitation,
    invitationRefusal,
    type InvitationRefusal,
    type PersonalInvitationView,
} from './personalInvitationClient';

export interface InviteBuilderSheetProps {
    farmId: string;
    farmName: string;
    farmPlots: readonly FarmPlot[];
    /** This farm's named workers (the हजेरी list), for "this is रमेश". */
    workers?: readonly { id: string; displayName: string }[];
    onClose: () => void;
    /** The server made it (the caller refreshes the sent list). */
    onMade?: (invitation: PersonalInvitationView) => void;
    /** An invitation already made, to show its delivery again. */
    showing?: PersonalInvitationView | null;
}

export const InviteBuilderSheet: React.FC<InviteBuilderSheetProps> = ({
    farmId, farmName, farmPlots, workers = [], onClose, onMade, showing = null,
}) => {
    const language = useOptionalLanguage()?.language;
    const copy = invitationCopy(language);
    const [grant, setGrant] = useState<InviteGrant>(() => presetGrant('Worker'));
    const [eachOpen, setEachOpen] = useState(false);
    const [name, setName] = useState('');
    const [mobile, setMobile] = useState('');
    const [workerId, setWorkerId] = useState('');
    const [busy, setBusy] = useState(false);
    const [refusal, setRefusal] = useState<InvitationRefusal | null>(null);
    const [made, setMade] = useState<PersonalInvitationView | null>(showing);
    const [qr, setQr] = useState<string | null>(null);
    const [qrOpen, setQrOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const mobileRead = readMobile(mobile);
    const canMake = !busy && mobileRead.ok && (grant.plotScope !== 'ChosenPlots' || grant.plotIds.length > 0);

    useEffect(() => {
        if (!made || !qrOpen) return;
        let live = true;
        QRCode.toDataURL(made.link, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
            .then(url => { if (live) setQr(url); })
            .catch(() => { if (live) setQr(null); });
        return () => { live = false; };
    }, [made, qrOpen]);

    const make = async () => {
        if (!canMake) return;
        setBusy(true);
        setRefusal(null);
        try {
            const view = await createInvitation(farmId, createBody(grant, { name, mobile: mobileRead.digits, fieldOperatorId: workerId || null }));
            setMade(view);
            onMade?.(view);
        } catch (error) {
            setRefusal(invitationRefusal(error));
        } finally {
            setBusy(false);
        }
    };

    const sendLink = async () => {
        if (!made) return;
        const text = copy.shareText(farmName, displayInvitationCode(made.code), made.link);
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({ text, url: made.link });
                return;
            } catch {
                // Cancelled or not allowed: fall back to copying the same text.
            }
        }
        try {
            await navigator.clipboard?.writeText(text);
            setCopied(true);
        } catch {
            /* clipboard refused: the code is on the screen to read out */
        }
    };

    const seesMoney = holds(grant, AUTHORITY.seeMoney);
    const ruledOut = notInForce(grant);

    return (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-stone-50" role="dialog" aria-modal="true" aria-label={copy.builderTitle} data-testid="invite-builder">
            <div className="mx-auto max-w-md space-y-3 px-4 pb-10 pt-4">
                <div className="flex items-center justify-between">
                    <h2 className="m-0 text-[20px] font-extrabold text-stone-900">{copy.builderTitle}</h2>
                    <button type="button" onClick={onClose} aria-label={copy.close} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-stone-200">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                {!made && (
                    <>
                        <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                            <p className="m-0 text-[15px] font-extrabold text-stone-800">{copy.whoQuestion}</p>
                            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={copy.whoQuestion}>
                                {INVITATION_LABELS.map(label => (
                                    <button key={label} type="button" role="radio" aria-checked={grant.label === label}
                                        data-testid={`invite-label-${label}`}
                                        onClick={() => setGrant(g => withLabel(g, label))}
                                        className={`min-h-[44px] rounded-full px-4 text-[15px] font-extrabold ring-1 ${grant.label === label ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-stone-700 ring-stone-300'}`}>
                                        {copy.labels[label]}
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                            <p className="m-0 text-[15px] font-extrabold text-stone-800">{copy.plotsQuestion}</p>
                            <PlotScopePicker memberId="invite" value={{ plotScope: grant.plotScope, plotIds: grant.plotIds }}
                                farmPlots={farmPlots} busy={busy}
                                choices={grant.label === 'Worker' ? ['OwnWork', 'ChosenPlots'] : undefined}
                                onSave={choice => setGrant(g => withPlots(g, choice.plotScope, choice.plotIds))} />
                        </section>

                        <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid="invite-responsibility">
                            <p className="m-0 text-[15px] font-extrabold text-stone-800">{copy.responsibilityQuestion}</p>
                            <ul className="m-0 flex flex-wrap gap-1.5 p-0" data-testid="invite-shown-grant">
                                {grant.authorities.map(a => (
                                    <li key={a.name} data-testid={`invite-shown-${a.name}`}
                                        className="list-none rounded-full bg-emerald-50 px-3 py-1 text-[13px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                                        {copy.can[a.name] ?? a.name}{a.expiresAtUtc ? ` (${copy.untilDay(dayOf(a.expiresAtUtc, language))})` : ''}
                                    </li>
                                ))}
                                {!seesMoney && (
                                    <li className="list-none rounded-full bg-stone-100 px-3 py-1 text-[13px] font-bold text-stone-600">{copy.noMoney}</li>
                                )}
                            </ul>
                            <p className="m-0 pt-1 text-[15px] font-extrabold text-stone-800">{copy.moneyQuestion}</p>
                            <div className="flex gap-2" role="radiogroup" aria-label={copy.moneyQuestion}>
                                {[true, false].map(yes => (
                                    <button key={String(yes)} type="button" role="radio" aria-checked={seesMoney === yes}
                                        data-testid={`invite-money-${yes ? 'yes' : 'no'}`}
                                        onClick={() => setGrant(g => withMoney(g, yes))}
                                        className={`min-h-[44px] flex-1 rounded-full text-[15px] font-extrabold ring-1 ${seesMoney === yes ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-stone-700 ring-stone-300'}`}>
                                        {yes ? copy.yes : copy.no}
                                    </button>
                                ))}
                            </div>
                            <button type="button" data-testid="invite-change-each" onClick={() => setEachOpen(o => !o)}
                                className="min-h-[44px] w-full rounded-xl bg-stone-50 text-[14px] font-extrabold text-stone-700 ring-1 ring-stone-200">
                                {eachOpen ? copy.hideEach : copy.changeEach}
                            </button>
                            {eachOpen && (
                                <AuthoritySwitches memberId="invite" access={{
                                    authorities: grant.authorities,
                                    notInForce: ruledOut,
                                    saving: busy,
                                    onChange: next => setGrant(g => withAuthorities(g, next)),
                                }} />
                            )}
                        </section>

                        <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                            <label className="block text-[14px] font-extrabold text-stone-700">
                                {copy.nameLabel}
                                <input data-testid="invite-name" value={name} maxLength={120} onChange={e => setName(e.target.value)}
                                    className="mt-1 min-h-[48px] w-full rounded-xl border border-stone-200 px-3 text-[16px]" />
                            </label>
                            <label className="block text-[14px] font-extrabold text-stone-700">
                                {copy.phoneLabel}
                                <input data-testid="invite-mobile" value={mobile} inputMode="tel" maxLength={16} onChange={e => setMobile(e.target.value)}
                                    className="mt-1 min-h-[48px] w-full rounded-xl border border-stone-200 px-3 text-[16px]" />
                            </label>
                            <p className="m-0 text-[12.5px] font-semibold leading-snug text-stone-600">{copy.phoneHint}</p>
                            {!mobileRead.ok && <p className="m-0 text-[13px] font-bold text-amber-700" data-testid="invite-mobile-wrong">{copy.phoneWrong}</p>}
                            {workers.length > 0 && (
                                <label className="block text-[14px] font-extrabold text-stone-700">
                                    {copy.workerLabel}
                                    <select data-testid="invite-worker" value={workerId} onChange={e => setWorkerId(e.target.value)}
                                        className="mt-1 min-h-[48px] w-full rounded-xl border border-stone-200 bg-white px-3 text-[16px]">
                                        <option value="">{copy.workerNone}</option>
                                        {workers.map(w => <option key={w.id} value={w.id}>{w.displayName}</option>)}
                                    </select>
                                </label>
                            )}
                        </section>

                        {refusal && (
                            <p role="alert" data-testid="invite-refused" className="m-0 rounded-2xl bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-800 ring-1 ring-rose-200">
                                {copy.refusal[refusal]}
                            </p>
                        )}
                        <button type="button" data-testid="invite-make" disabled={!canMake} onClick={() => void make()}
                            className="min-h-[56px] w-full rounded-2xl bg-emerald-600 text-[18px] font-extrabold text-white disabled:opacity-60">
                            {busy ? copy.making : copy.make}
                        </button>
                    </>
                )}

                {made && (
                    <section className="space-y-3 rounded-2xl bg-white p-4 text-center ring-1 ring-emerald-200" data-testid="invite-delivery">
                        <p className="m-0 font-mono text-[30px] font-extrabold tracking-[0.15em] text-stone-900" data-testid="invite-code">
                            {displayInvitationCode(made.code)}
                        </p>
                        <p className="m-0 text-[13px] font-bold text-stone-600">{copy.onceUntil(dayOf(made.expiresAtUtc, language))}</p>
                        <button type="button" data-testid="invite-show-qr" onClick={() => setQrOpen(true)}
                            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-[17px] font-extrabold text-white">
                            <QrCode size={20} aria-hidden="true" />{copy.showQr}
                        </button>
                        {qrOpen && qr && <img src={qr} alt={copy.codeLine(displayInvitationCode(made.code))} className="mx-auto h-64 w-64" data-testid="invite-qr" />}
                        <button type="button" data-testid="invite-send-link" onClick={() => void sendLink()}
                            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-[17px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">
                            <Link2 size={20} aria-hidden="true" />{copy.sendLink}
                        </button>
                        {copied && <p role="status" className="m-0 text-[13px] font-bold text-emerald-700">{copy.copied}</p>}
                        <button type="button" onClick={onClose} className="min-h-[48px] w-full rounded-2xl bg-stone-100 text-[15px] font-extrabold text-stone-700">
                            {copy.done}
                        </button>
                    </section>
                )}
            </div>
        </div>
    );
};

export default InviteBuilderSheet;
