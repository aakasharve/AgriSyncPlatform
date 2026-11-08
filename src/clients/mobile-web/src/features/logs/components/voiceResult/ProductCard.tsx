/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founder 2026-11-06 Option 3 of DFES-result-options.html,
 * D-95, D-93) - the bottom card one tap on a product row opens: every fact about the product, and हो / नाही / फोटो.
 *
 *   - Facts are the library's (ingredient, form, company) in the screen's language, labelled "माहिती: श्रमसफल लायब्ररी"; the
 *     amount is what HE said, never a dose from the library (P4). A fact the library holds only in English is not shown in
 *     Marathi mode (language strict).
 *   - A speaker WITHOUT the confirm-records authority is asked "माहीत असेल तर सांगा (ऐच्छिक)" and closes with "माहीत नाही, मालक
 *     पाहतील"; a checker is asked "हेच औषध वापरलं का?" and closes with "नंतर पाहीन". His answer is kept as HIS. The phone sends no
 *     "is check" - the server decides (D-95). Nothing here blocks saving or confirming (P9).
 *   - A product the library does not know (or knows by a shared name) offers the photo and the close button only: there is no
 *     pick-from-list yet, so a "हो" cannot be recorded for it. A photo reads "फोटो ठेवला" (D-93, P5).
 *   - Money: a matched purchase bill shows its amount only to a member who may see money (MU-3).
 *   - The card only reads the record. An answer is queued as an overlay and never edits the record (P7).
 */
import React, { useState } from 'react';
import { Camera, CircleHelp, ShieldCheck, X } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { inputWords } from '../../../../domain/inputs/inputWords';
import { toMarathiNumber } from '../../services/disciplineRecognition';
import { amountText, productName, type ProductItem } from './productModel';
import {
    answersOf,
    benefitFor,
    identityOf,
    isAnswerable,
    TYPE_STYLE,
    typeKeyOf,
    type ItemAnswers,
    type ItemIdentity,
} from './inputIdentityModel';
import type { DailyLog, InputIdentityAnswer } from '../../../../domain/types/log.types';
import { resultCopy } from './resultCopy';

const SANS = "'Noto Sans Devanagari', sans-serif";
const LATIN = /[A-Za-z]/;

/** What the screen hands the product rows to answer with (the container owns the queue, the camera and the roles). */
export interface ProductAnswerKit {
    /** Every record of the day on this screen, by id (the answers ride on them). */
    logById: ReadonlyMap<string, DailyLog>;
    /** This viewer holds the confirm-records authority on the farm (the server decides what it does with an answer). */
    canCheck: boolean;
    /** This viewer may see money on the farm (MU-3). */
    canSeeMoney: boolean;
    /** A real name for whoever answered; the unknown label when the name is not known - never "तुम्ही". */
    nameOfUser: (userId: string | null | undefined) => string;
    /** The crop names of a record (stored as the server sent them), for the sourced benefit line. */
    cropNamesOf: (logId: string) => readonly string[];
    onAnswer: (a: { logId: string; item: ProductItem; verdict: 'confirmed' | 'rejected'; catalogProductId?: string }) => Promise<void>;
    onPhoto: (a: { logId: string; item: ProductItem }) => Promise<void>;
    /** A purchase bill matched to this product, when one is (lane IT6; none today). */
    billOf?: (logId: string, item: ProductItem) => { date: string; amount?: number } | undefined;
}

const isLatinOnly = (s: string): boolean => LATIN.test(s) && !/[ऀ-ॿ]/.test(s);

/** A library text in this language: Marathi mode never shows a Latin-only value (the library keeps some facts in English only). */
const inLanguage = (text: string | null | undefined, language: string | undefined): string => {
    const s = (text ?? '').trim();
    return language !== 'en' && isLatinOnly(s) ? '' : s;
};

export function ingredientLine(identity: ItemIdentity, language: string | undefined): string {
    if (identity.state !== 'found') return '';
    const en = language === 'en';
    return identity.product.activeIngredients
        .map(i => [en ? i.en : i.mr, en ? i.pct : (i.pctMr ?? i.pct)].map(t => inLanguage(t, language)).filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' + ');
}

export function formLine(identity: ItemIdentity, language: string | undefined): string {
    if (identity.state !== 'found' || !identity.product.formulation) return '';
    const f = identity.product.formulation;
    return language === 'en' ? f.code.toUpperCase() : inLanguage(f.mr, language);
}

export function companyLine(identity: ItemIdentity, language: string | undefined): string {
    if (identity.state !== 'found') return '';
    const p = identity.product;
    const en = language === 'en';
    const names = [en ? p.company : p.companyMr, ...p.brands.map(b => (en ? b.company : b.companyMr))].map(c => inLanguage(c, language)).filter(Boolean);
    return names[0] ?? '';
}

const Fact: React.FC<{ label: string; children: React.ReactNode; testId?: string }> = ({ label, children, testId }) => (
    <div className="flex gap-2 py-1" data-testid={testId}>
        <span className="w-[104px] shrink-0 text-[13.5px] font-bold text-stone-500">{label}</span>
        <span className="min-w-0 text-[15px] font-bold text-stone-900">{children}</span>
    </div>
);

export interface ProductCardProps {
    item: ProductItem;
    logId: string;
    kit: ProductAnswerKit;
    onClose: () => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ item, logId, kit, onClose }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const words = inputWords(language === 'en' ? 'en' : 'mr');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState<null | 'answer' | 'photo'>(null);

    const identity = identityOf(item);
    const log = kit.logById.get(logId);
    const answers: ItemAnswers = answersOf(log, item.ref);
    const style = TYPE_STYLE[typeKeyOf(identity)];
    const found = identity.state === 'found';
    const answerable = isAnswerable(item);
    const name = productName(item, language) || (item.matchName ?? '');
    const amount = amountText(item.amount, language);
    const bill = kit.billOf?.(logId, item);
    const benefit = found ? benefitFor(identity.product, kit.cropNamesOf(logId), answers) : undefined;
    const photoKept = answers.speaker?.verdict === 'photo' || answers.check?.verdict === 'photo';

    const run = async (kind: 'answer' | 'photo', go: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        setFailed(null);
        try {
            await go();
            onClose();
        } catch {
            setFailed(kind);
            setBusy(false);
        }
    };

    const said = (a: InputIdentityAnswer | undefined): string | null => {
        if (!a) return null;
        const what = a.verdict === 'confirmed' ? copy.yesThis : a.verdict === 'rejected' ? copy.notThis : words.photoKept;
        return copy.speakerSaid(kit.nameOfUser(a.assertedByUserId), what);
    };
    const checkedLine = (a: InputIdentityAnswer | undefined): string | null => {
        if (!a) return null;
        const who = kit.nameOfUser(a.assertedByUserId);
        return a.verdict === 'confirmed' ? copy.checkedYes(who) : a.verdict === 'rejected' ? copy.checkedNo(who) : copy.checkedPhoto(who);
    };

    // His answer that is still waiting to go (or to come back): the same answer is not queued twice - its button is off until the
    // server has it. A different answer (a changed mind) is a new request. A photo may always be taken again.
    const waiting = (verdict: InputIdentityAnswer['verdict']): boolean =>
        [answers.speaker, answers.check].some(a => a?.pending === true && a.verdict === verdict);

    const closeLabel = answers.speaker || answers.check ? copy.close : kit.canCheck ? copy.closeChecker : copy.closeSpeaker;

    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" data-testid="vr-product-sheet" role="dialog" aria-modal="true"
            style={{ fontFamily: SANS }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="max-h-[85%] overflow-auto rounded-t-[28px] bg-white px-4 pb-5 pt-2.5" data-testid="vr-product-card" data-type={typeKeyOf(identity)}>
                <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-stone-300" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[22px] font-extrabold text-stone-900" data-testid="vr-card-name">{name}</span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[13.5px] font-extrabold ring-1 ${style.pill}`} data-testid="vr-card-type">
                        {copy.typeNames[typeKeyOf(identity)]}
                    </span>
                </div>

                {found ? (
                    <div className={`mt-2 rounded-2xl border-l-[6px] ${style.edge} ${style.soft} px-3 py-1.5`} data-testid="vr-card-facts">
                        {ingredientLine(identity, language) && (
                            <Fact label={copy.factIngredient} testId="vr-fact-ingredient">
                                {[ingredientLine(identity, language), formLine(identity, language)].filter(Boolean).join(' · ')}
                            </Fact>
                        )}
                        {companyLine(identity, language) && <Fact label={copy.factCompany} testId="vr-fact-company">{companyLine(identity, language)}</Fact>}
                        {amount && <Fact label={copy.factDose} testId="vr-fact-dose">{amount}</Fact>}
                        {bill && (
                            <Fact label={copy.factBill} testId="vr-fact-bill">
                                <span className="text-sky-800">
                                    {copy.billMatched(bill.date, kit.canSeeMoney && typeof bill.amount === 'number'
                                        ? `₹${language === 'en' ? bill.amount : toMarathiNumber(bill.amount)}` : undefined)}
                                </span>
                            </Fact>
                        )}
                        {benefit && (
                            <Fact label={copy.factBenefit} testId="vr-fact-benefit">
                                {language === 'en' ? benefit.en : benefit.mr}
                                <span className="ml-1.5 inline-block rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-bold text-sky-800 ring-1 ring-sky-200" data-testid="vr-benefit-web">{words.fromWeb}</span>
                            </Fact>
                        )}
                    </div>
                ) : (
                    <div className="mt-2 rounded-2xl border-2 border-dashed border-stone-400 bg-stone-50 p-3" data-testid="vr-card-unknown">
                        <div className="flex items-center gap-2 text-[15px] font-bold text-stone-700">
                            {photoKept ? <Camera size={18} aria-hidden="true" /> : <CircleHelp size={18} aria-hidden="true" />}
                            <span data-testid="vr-card-unknown-note">
                                {photoKept ? words.photoKept : identity.state === 'ambiguous' ? copy.ambiguousLine : words.notFound}
                            </span>
                        </div>
                        {amount && <Fact label={copy.factDose} testId="vr-fact-dose">{amount}</Fact>}
                        {answerable && !photoKept && (
                            <button type="button" disabled={busy} onClick={() => void run('photo', () => kit.onPhoto({ logId, item }))} data-testid="vr-card-photo"
                                className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-emerald-700 text-[16px] font-extrabold text-white disabled:opacity-60">
                                <Camera size={20} aria-hidden="true" />{copy.takePhoto}
                            </button>
                        )}
                    </div>
                )}

                {/* What has been said and checked about it. The speaker's answer stays his; the check is the server's word. */}
                {said(answers.speaker) && (
                    <div className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-sky-50 px-3 py-2 text-[15px] font-extrabold text-sky-900" data-testid="vr-card-speaker-said">
                        {said(answers.speaker)}
                    </div>
                )}
                {checkedLine(answers.check) && (
                    <div className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[15px] font-extrabold text-emerald-900" data-testid="vr-card-checked">
                        <ShieldCheck size={20} aria-hidden="true" />{checkedLine(answers.check)}
                    </div>
                )}

                {found && answerable && (
                    <>
                        <div className="mt-3 text-[16px] font-extrabold" data-testid="vr-card-question">{kit.canCheck ? copy.askChecker : copy.askSpeaker}</div>
                        <div className="mt-1.5 flex gap-2">
                            <button type="button" disabled={busy || waiting('confirmed')} data-testid="vr-answer-yes"
                                onClick={() => void run('answer', () => kit.onAnswer({ logId, item, verdict: 'confirmed', catalogProductId: identity.product.id }))}
                                className="min-h-[48px] flex-1 rounded-full bg-emerald-700 text-[16px] font-extrabold text-white disabled:opacity-60">{copy.answerYes}</button>
                            <button type="button" disabled={busy || waiting('rejected')} data-testid="vr-answer-no"
                                onClick={() => void run('answer', () => kit.onAnswer({ logId, item, verdict: 'rejected' }))}
                                className="min-h-[48px] flex-1 rounded-full border-2 border-stone-300 bg-white text-[16px] font-extrabold text-stone-900 disabled:opacity-60">{copy.answerNo}</button>
                            <button type="button" disabled={busy} data-testid="vr-answer-photo"
                                onClick={() => void run('photo', () => kit.onPhoto({ logId, item }))}
                                className="min-h-[48px] flex-1 rounded-full border-2 border-emerald-600 bg-white text-[16px] font-extrabold text-emerald-800 disabled:opacity-60">{copy.answerPhoto}</button>
                        </div>
                    </>
                )}
                {failed && (
                    <p className="m-0 mt-1.5 flex items-center gap-1 text-[13.5px] font-bold text-amber-800" role="status" data-testid="vr-card-failed">
                        <X size={14} aria-hidden="true" />{failed === 'photo' ? copy.photoFailed : copy.answerFailed}
                    </p>
                )}

                {found && <div className="mt-2 text-[12px] font-semibold text-stone-500" data-testid="vr-card-source">{words.fromLibrary}</div>}
                <button type="button" onClick={onClose} data-testid="vr-card-close"
                    className="mt-3 min-h-[50px] w-full rounded-2xl border-2 border-stone-300 text-[16px] font-extrabold text-stone-900">
                    {closeLabel}
                </button>
            </div>
        </div>
    );
};

export default ProductCard;
