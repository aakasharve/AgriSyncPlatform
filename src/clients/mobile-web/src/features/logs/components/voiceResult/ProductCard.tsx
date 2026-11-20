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
 *   - A product the library does not know exactly (or knows by a shared name) offers the photo and the close button. Lane FACTS-2: when
 *     library names SOUND like his word, they are shown as buttons - "तुम्हाला हे म्हणायचं होतं का?" - and his tap on one is the same
 *     "हो, हेच" answer, naming that product; nothing is chosen for him, and the card then says he chose it. A photo reads "फोटो ठेवला" (D-93, P5).
 *   - Money: a matched purchase bill shows its amount only to a member who may see money (MU-3).
 *   - The card only reads the record. An answer is queued as an overlay and never edits the record (P7).
 */
import React, { useState } from 'react';
import { Camera, CircleHelp, ShieldCheck, Sprout, TriangleAlert, X } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { inputWords } from '../../../../domain/inputs/inputWords';
import { getProduct, type CatalogProduct } from '../../../../domain/inputs/inputCatalog';
import { nearProducts, type NearProduct } from '../../../../domain/inputs/nearNames';
import { factSources, ingredientFactsFor, ingredientKeysOf, stageLinesFor, type FactsLanguage, type UseContext } from '../../../../domain/inputs/ingredientFacts';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { amountText, productName, type ProductItem } from './productModel';
import {
    answersOf,
    benefitFor,
    identityOf,
    isAnswerable,
    nameForMatching,
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
    /** Lane FACTS-1 - the day of the season and the stage of this use, from the plot's own schedule (absent or null = not known; the lines are left out). */
    useContextOf?: (logId: string) => UseContext | null;
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
        // The percentage is a number: its digits follow the screen's language (IT-D2). The ingredient's name is a name and is left as the library has it.
        .map(i => [inLanguage(en ? i.en : i.mr, language), digitsFor(inLanguage(en ? i.pct : (i.pctMr ?? i.pct), language), language)].filter(Boolean).join(' '))
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

/** A library brand in this screen's language: the Marathi spelling in Marathi mode when the library has one, else the other spelling (a brand is a name). */
const brandIn = (b: { en: string | null; mr: string | null } | null | undefined, language: string | undefined): string =>
    ((language === 'en' ? b?.en ?? b?.mr : b?.mr ?? b?.en) ?? '').trim();

/** The name of a library product for the screen: its first brand, else its first alias. */
export function libraryNameOf(product: CatalogProduct, language: string | undefined): string {
    return brandIn(product.brands[0], language) || product.aliases[0] || product.id;
}

/** The name a "did you mean" button shows: the brand the sound matched, in this language; the library's own spelling for an alias. */
export function nearBrandName(n: NearProduct, language: string | undefined): string {
    return brandIn(n.brand, language) || n.matchedName;
}

const Fact: React.FC<{ label: string; children: React.ReactNode; testId?: string }> = ({ label, children, testId }) => (
    <div className="flex gap-2 py-1" data-testid={testId}>
        <span className="w-[104px] shrink-0 text-[13.5px] font-bold text-stone-500">{label}</span>
        <span className="min-w-0 text-[15px] font-bold text-stone-900">{children}</span>
    </div>
);

/** Where a fact line came from: the packet, the library, or a named web source (the existing "इंटरनेटवरून" mark). */
const SourceMarks: React.FC<{ keys: readonly string[]; lang: FactsLanguage; ticked: boolean }> = ({ keys, lang, ticked }) => {
    const words = inputWords(lang);
    const copy = resultCopy(lang);
    const src = factSources();
    return (
        <>
            {keys.map(k => {
                const cls = k === 'PKT' ? 'bg-stone-100 text-stone-700 ring-stone-300' : k === 'LIB' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-sky-50 text-sky-800 ring-sky-200';
                const label = k === 'PKT' ? copy.fromPacket : k === 'LIB' ? words.fromLibrary : `${words.fromWeb} · ${lang === 'en' ? src[k]?.shortEn ?? k : src[k]?.short ?? k}`;
                return <span key={k} data-src={k} className={`ml-1 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ${cls}`}>{label}</span>;
            })}
            {!ticked && <span data-testid="vr-fact-untick" className="ml-1 inline-block whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 ring-1 ring-amber-300">{copy.pendingTick}</span>}
        </>
    );
};

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

    const log = kit.logById.get(logId);
    const answers: ItemAnswers = answersOf(log, item.ref);
    const identity = identityOf(item, answers);
    const style = TYPE_STYLE[typeKeyOf(identity)];
    const found = identity.state === 'found';
    const answerable = isAnswerable(item);
    const name = productName(item, language) || (item.matchName ?? '');
    const amount = amountText(item.amount, language, true);
    const bill = kit.billOf?.(logId, item);
    const benefit = found ? benefitFor(identity.product, kit.cropNamesOf(logId), answers) : undefined;
    const photoKept = answers.speaker?.verdict === 'photo' || answers.check?.verdict === 'photo';
    // Lane FACTS-2: a word the library does not know exactly gets the library names that SOUND like it, to tap. Never chosen for him.
    const near = identity.state === 'notFound' && answerable && !photoKept ? nearProducts(nameForMatching(item)) : [];
    // Lane FACTS-1: what each ingredient does and what to know at this stage - only sourced, ticked lines (P4, D-96); the day and stage from the plot's schedule.
    const lang: FactsLanguage = language === 'en' ? 'en' : 'mr';
    const useContext = found ? kit.useContextOf?.(logId) ?? null : null;
    const ingredientFacts = found ? ingredientFactsFor(identity.product, lang) : [];
    const stageLines = found ? stageLinesFor(ingredientKeysOf(identity.product), useContext, lang, undefined, n => digitsFor(n, language)) : [];

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
                {identity.state === 'found' && identity.byPick && (
                    <div className="mt-1.5 rounded-xl bg-sky-50 px-3 py-1.5 text-[14px] font-bold leading-snug text-sky-900 ring-1 ring-sky-200" data-testid="vr-card-picked">
                        {copy.pickedNote(name, libraryNameOf(identity.product, language))}
                    </div>
                )}

                {found ? (
                    <div className={`mt-2 rounded-2xl border-l-[6px] ${style.edge} ${style.soft} px-3 py-1.5`} data-testid="vr-card-facts">
                        {ingredientLine(identity, language) && (
                            <Fact label={copy.factIngredient} testId="vr-fact-ingredient">
                                {[ingredientLine(identity, language), formLine(identity, language)].filter(Boolean).join(' · ')}
                            </Fact>
                        )}
                        {companyLine(identity, language) && <Fact label={copy.factCompany} testId="vr-fact-company">{companyLine(identity, language)}</Fact>}
                        {useContext && useContext.day !== null && useContext.refType && (
                            <Fact label={copy.factWhen} testId="vr-fact-when">{copy.dayAfter(useContext.refType, digitsFor(useContext.day, language))}</Fact>
                        )}
                        {useContext && useContext.stageName && language !== 'en' && <Fact label={copy.factStage} testId="vr-fact-stage">{useContext.stageName}</Fact>}
                        {amount
                            ? <Fact label={copy.factDose} testId="vr-fact-dose">{amount}</Fact>
                            : <Fact label={copy.factDose} testId="vr-fact-dose-none"><span className="font-semibold text-stone-600">{copy.doseNotSaid}</span></Fact>}
                        {bill && (
                            <Fact label={copy.factBill} testId="vr-fact-bill">
                                <span className="text-sky-800">
                                    {copy.billMatched(digitsFor(bill.date, language), kit.canSeeMoney && typeof bill.amount === 'number'
                                        ? `₹${digitsFor(bill.amount, language)}` : undefined)}
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
                        {near.length > 0 && (
                            <div className="mt-2" data-testid="vr-card-near">
                                <div className="text-[15px] font-extrabold text-stone-900" data-testid="vr-near-question">{copy.didYouMean}</div>
                                <div className="mt-1.5 space-y-1.5">
                                    {near.map(n => {
                                        const product = getProduct(n.productId);
                                        if (!product) return null;
                                        const brand = nearBrandName(n, language);
                                        const line = [ingredientLine({ state: 'found', product }, language), companyLine({ state: 'found', product }, language)].filter(Boolean).join(' · ');
                                        return (
                                            <button key={n.productId} type="button" disabled={busy} data-testid={`vr-near-${n.productId}`}
                                                onClick={() => void run('answer', () => kit.onAnswer({ logId, item, verdict: 'confirmed', catalogProductId: n.productId }))}
                                                className="block min-h-[52px] w-full rounded-2xl border-2 border-sky-300 bg-white px-3 py-1.5 text-left disabled:opacity-60">
                                                <span className="block text-[17px] font-extrabold text-stone-900">{brand}</span>
                                                {line && <span className="block text-[13.5px] font-bold text-stone-600">{line}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-1.5 text-[13px] font-semibold text-stone-600" data-testid="vr-near-hint">{copy.didYouMeanHint}</div>
                            </div>
                        )}
                        {answerable && !photoKept && (
                            <button type="button" disabled={busy} onClick={() => void run('photo', () => kit.onPhoto({ logId, item }))} data-testid="vr-card-photo"
                                className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-emerald-700 text-[16px] font-extrabold text-white disabled:opacity-60">
                                <Camera size={20} aria-hidden="true" />{copy.takePhoto}
                            </button>
                        )}
                    </div>
                )}

                {/* Lane FACTS-1 (founder 2026-11-19): what each ingredient does, with its source. Only ticked lines; none = nothing drawn (P4). */}
                {ingredientFacts.length > 0 && (
                    <div className="mt-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-stone-300" data-testid="vr-card-does">
                        {ingredientFacts.map((f, i) => (
                            <div key={f.key} className={i ? 'mt-2 border-t border-stone-200 pt-2' : ''} data-testid={`vr-does-${f.key}`}>
                                <div className="text-[15px] font-extrabold text-stone-900">{f.label}</div>
                                <div className="mt-0.5 text-[14.5px] font-semibold leading-snug text-stone-800">
                                    {copy.factDoes}: {f.does}<SourceMarks keys={f.sources} lang={lang} ticked={f.ticked} />
                                </div>
                                {f.caution && (
                                    <div className="mt-1 flex items-start gap-1.5 rounded-xl bg-amber-50 px-2.5 py-1.5 text-[14px] font-extrabold text-amber-900 ring-1 ring-amber-200" data-testid="vr-does-caution">
                                        <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                        <span>{f.caution.text}<SourceMarks keys={f.caution.sources} lang={lang} ticked={f.caution.ticked} /></span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {stageLines.length > 0 && (
                    <div className={`mt-2 rounded-2xl px-3 py-2 ring-1 ${stageLines.some(l => l.warn) ? 'bg-amber-50 ring-amber-300' : 'bg-lime-50 ring-lime-300'}`} data-testid="vr-card-stage-lines">
                        <div className="flex items-center gap-1.5 text-[14.5px] font-extrabold text-stone-900"><Sprout size={17} className="text-lime-800" aria-hidden="true" />{copy.atThisStage}</div>
                        {stageLines.map(l => (
                            <div key={l.id} className="mt-1 text-[14.5px] font-bold leading-snug text-stone-900" data-testid={`vr-stage-${l.id}`}>
                                {l.text}{l.compare ? <> {l.compare}</> : null}<SourceMarks keys={l.sources} lang={lang} ticked={l.ticked} />
                            </div>
                        ))}
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
