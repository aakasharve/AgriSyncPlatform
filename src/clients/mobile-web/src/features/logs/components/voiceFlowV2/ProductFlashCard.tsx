/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B2) — the product flash card, as the final design draws it
 * (result-v12-final.html `openProd()`, `prodBody()`, `prodBlock()`, `closeProd()`).
 *
 * A tap on a library product's row grows this card out of that row to fill the phone. It is ONE scrolling page, in this order for
 * the product, then the same for every other product of the same release ("याच टाकीत"), then the rest of this talk:
 *   1. the product: its name, type and company;
 *   2. what he gave: the amount as HE said it, the release, its water and tank count, and his own words (P8);
 *   3. what it is for: the library's sourced pests / diseases (`productFlash.targetGroupsOf`, named through `catalogTermNames`);
 *   4. how it works: ONLY what the agronomist ticked (D-199 = b), else nothing;
 *   5. what is in it: the ingredient and %, the form, how it is given (the group only when ticked, for a checker);
 *   6. its other names;
 *   7. "तपासायची": when this row comes into view the check card (`CheckCard`) pops up by itself, unless it was answered or he closed
 *      it once this session; the row also opens it on a tap;
 *   8. where the facts come from, and that the expert's check is pending while it is.
 * At the end ("सगळं पाहिलं"), once he scrolled there and it stayed in view a moment, the card snaps back into its row by itself; the
 * ×, the backdrop and the phone's back do the same. Haptics on the grow and the snap back; with reduced motion the card simply
 * appears and goes (no growing, no snapping).
 *
 * It reads the record and the library only. Products the library does not know keep the existing bottom card (`ProductCard`: its
 * photo and "did you mean" names) — the caller decides.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { PartIcon } from '../voiceResult/HisWords';
import { companyLine, type ProductAnswerKit } from '../voiceResult/ProductCard';
import { answersOf, identityOf, typeKeyOfItem } from '../voiceResult/inputIdentityModel';
import { amountText, nameIsPhrase, productName, type ProductBox, type ProductItem } from '../voiceResult/productModel';
import { resultCopy } from '../voiceResult/resultCopy';
import { partMeta, type DayView, type Who } from '../voiceResult/resultModel';
import { finalResultWords } from './finalResultWords';
import { CheckCard, CheckRow, checkKeyOf, checkStateOf, isCheckable, wasCheckDismissed, type CheckState } from './ProductCheck';
import { howItWorksOf, insideOf, librarySourcesChecked, otherNamesOf, targetGroupsOf } from './productFlash';
import { SaidLine, SANS } from './savedBits';
import SavedPartsGrid from './SavedPartsGrid';
import { releaseWaterOf, type RowRect, type TankWords } from './SavedProducts';
import { useWhenInView } from './useWhenInView';

const SERIF = "'Noto Serif Devanagari', serif";
const INPUTS_TINT = partMeta('inputs').tint;
const GROW_MS = 460;
const SNAP_MS = 300;

const prefersReducedMotion = (): boolean => {
    try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** The phone column the card fills (the voice layer's column; the window when there is none), inset as the design insets it. */
const fullRect = (): RowRect => {
    const col = typeof document !== 'undefined' ? document.querySelector('[data-testid="voice-layer"] > div')?.getBoundingClientRect() : undefined;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 760;
    const left = col && col.width > 0 ? col.left : 0;
    const width = col && col.width > 0 ? col.width : vw;
    return { left: left + 8, top: 10, width: Math.max(0, width - 16), height: Math.max(0, vh - 20) };
};

const PILL_INK: Record<string, string> = { insecticide: 'text-[#9D174D] bg-[#FCE7F3]', fungicide: 'text-[#075985] bg-[#E0F2FE]', fertilizer: 'text-[#92400E] bg-[#FEF3C7]', herbicide: 'text-orange-800 bg-orange-50', pgr: 'text-emerald-800 bg-emerald-50' };
const CHIP_INK: Record<string, string> = { pest: 'bg-[#FCE7F3] text-[#9D174D]', disease: 'bg-[#E0F2FE] text-[#075985]', weed: 'bg-orange-50 text-orange-900', crop: 'bg-[#DCFCE7] text-[#14532D]' };

const Block: React.FC<{ title: string; testId: string; children: React.ReactNode }> = ({ title, testId, children }) => (
    <section className="flex flex-col gap-2 rounded-[18px] border-[1.5px] border-[#E7E5E4] bg-white p-3" data-testid={testId}>
        <h4 className="m-0 text-[16.5px] font-extrabold text-[#1C1917]">{title}</h4>
        {children}
    </section>
);

interface ProductBlockProps {
    item: ProductItem;
    logId: string;
    kit: ProductAnswerKit;
    box: ProductBox | undefined;
    words: TankWords | undefined;
    speaker: Who | undefined;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    /** The card is fully open (the check may pop only then) and no check card is up. */
    canPop: boolean;
    checkStates: Readonly<Record<string, CheckState>>;
    onOpenCheck: (item: ProductItem) => void;
    testId: string;
}

/** One product of the release, in the design's order. */
const ProductBlock: React.FC<ProductBlockProps> = ({ item, logId, kit, box, words, speaker, scrollRef, canPop, checkStates, onOpenCheck, testId }) => {
    const language = useOptionalLanguage()?.language;
    const F = finalResultWords(language).flash;
    const FW = finalResultWords(language);
    const copy = resultCopy(language);
    const rowRef = useRef<HTMLButtonElement>(null);
    const answers = answersOf(kit.logById.get(logId), item.ref);
    const identity = identityOf(item, answers);
    const key = checkKeyOf(logId, item.id);
    const state = checkStates[key] ?? checkStateOf(answers, key);
    const checkable = isCheckable(item, logId, kit);
    useWhenInView(rowRef, scrollRef, {
        threshold: 0.85, delayMs: 450, enabled: canPop && checkable && !state && !wasCheckDismissed(key), onFire: () => onOpenCheck(item),
    });
    const typeKey = typeKeyOfItem(item, identity);
    const name = productName(item, language) || (item.matchName ?? '');
    const amount = nameIsPhrase(item, language) ? '' : amountText(item.amount, language, true);
    const kind = box ? (box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : '') : '';
    const waterLine = box ? releaseWaterOf(box, language) : '';
    const release = [kind, waterLine ? `${copy.water}: ${waterLine}` : '', words && words.tanks !== null ? FW.tanks(words.tanks) : ''].filter(Boolean);
    const said = words?.saidOf(item) ?? [];
    const found = identity.state === 'found' ? identity.product : null;
    const groups = found ? targetGroupsOf(found, language) : [];
    const how = found ? howItWorksOf(found, language) : null;
    const inside = found ? insideOf(found, language, { showGroup: kit.canCheck }) : [];
    const others = found ? otherNamesOf(found, name, language) : [];
    const company = found ? companyLine({ state: 'found', product: found }, language) : '';
    const groupTitle: Record<string, string> = { pest: F.forPests, disease: F.forDiseases, weed: F.forWeeds, crop: F.forCrop };
    const insideLabel: Record<string, string> = { ingredient: F.ingredient, form: F.form, method: F.method, group: F.group };
    return (
        <div className="flex flex-col gap-3" data-testid={testId} data-item={item.id}>
            <div className="flex items-center gap-3">
                <span className="grid h-[60px] w-[60px] flex-none place-items-center rounded-[18px]" style={{ background: INPUTS_TINT }}><PartIcon part="inputs" size={38} /></span>
                <span className="flex min-w-0 flex-col gap-1">
                    <b className="text-[30px] font-bold leading-[1.15] [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }} data-testid={`${testId}-name`}>{name}</b>
                    <span className="flex flex-wrap items-center gap-2">
                        {typeKey !== 'unknown' && <em className={`rounded-full px-2.5 py-px text-[13px] font-extrabold not-italic shadow-[inset_0_0_0_1px_currentColor] ${PILL_INK[typeKey] ?? ''}`}>{copy.typeNames[typeKey]}</em>}
                        {company && <small className="text-[14px] font-bold text-[#57534E]">{company}</small>}
                    </span>
                </span>
            </div>

            <section className="flex flex-col gap-1.5 rounded-[18px] border-2 border-[#DDD6FE] bg-[#F5F3FF] p-3" data-testid={`${testId}-gave`}>
                <span className="text-[13px] font-extrabold text-[#5B21B6]">{speaker && !speaker.you ? F.gaveBy(speaker.name) : F.gaveYou}</span>
                {amount && <b className="text-[40px] font-extrabold leading-[1.05] text-[#1C1917]" data-testid={`${testId}-amount`}>{amount}</b>}
                {release.length > 0 && <span className="text-[15px] font-bold text-[#44403C]" data-testid={`${testId}-release`}>{release.join(' · ')}</span>}
                <SaidLine quotes={said} tint={INPUTS_TINT} testId={`${testId}-said`} />
            </section>

            {!found && <p className="m-0 rounded-2xl border-2 border-dashed border-stone-400 bg-stone-50 p-3 text-[15px] font-bold text-stone-700" data-testid={`${testId}-unknown`}>{F.notInLibrary}</p>}

            {groups.map(g => (
                <Block key={g.kind} title={groupTitle[g.kind]} testId={`${testId}-for-${g.kind}`}>
                    <div className="flex flex-wrap gap-1.5">
                        {g.names.map(n => <span key={n} className={`rounded-xl px-2.5 py-1 text-[15.5px] font-extrabold ${CHIP_INK[g.kind]}`}>{n}</span>)}
                    </div>
                </Block>
            ))}

            {how && (
                <Block title={F.howItWorks} testId={`${testId}-how`}>
                    {how.modes.map(m => (
                        <div key={m.name} className="flex flex-col gap-1">
                            <span className="self-start rounded-full border-[1.5px] border-[#6EE7B7] bg-[#ECFDF5] px-3 py-0.5 text-[15px] font-extrabold text-[#065F46]">{m.name}</span>
                            {m.say && <p className="m-0 text-[15.5px] font-semibold leading-[1.5] text-[#292524]">{m.say}</p>}
                        </div>
                    ))}
                    {how.lines.map(l => <p key={l.key} className="m-0 text-[15.5px] font-semibold leading-[1.5] text-[#292524]"><b>{l.label}:</b> {l.does}</p>)}
                </Block>
            )}

            {inside.length > 0 && (
                <Block title={F.inside} testId={`${testId}-inside`}>
                    <div className="flex flex-col gap-[7px]">
                        {inside.map(r => (
                            <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-dashed border-[#E7E5E4] pb-1.5 text-[15.5px] last:border-b-0 last:pb-0" data-testid={`${testId}-inside-${r.key}`}>
                                <span className="flex-none font-bold text-[#57534E]">{insideLabel[r.key]}</span>
                                <b className="text-right font-extrabold">{r.value}</b>
                            </div>
                        ))}
                    </div>
                </Block>
            )}

            {others.length > 0 && (
                <Block title={F.otherNames(typeKey === 'fertilizer' ? F.kindFertiliser : F.kindMedicine)} testId={`${testId}-others`}>
                    <div className="flex flex-wrap gap-1.5">
                        {others.map(n => <span key={n} className="rounded-xl bg-[#F5F5F4] px-2.5 py-1 text-[15.5px] font-extrabold text-[#292524]">{n}</span>)}
                    </div>
                </Block>
            )}

            {checkable && <CheckRow ref={rowRef} state={state} onOpen={() => onOpenCheck(item)} testId={`${testId}-check`} />}

            {found && (
                <p className="m-0 text-center text-[12.5px] font-semibold text-[#78716C]" data-testid={`${testId}-source`}>
                    {librarySourcesChecked(found) ? F.fromLibrary : `${F.fromLibrary} · ${F.libraryPending}`}
                </p>
            )}
        </div>
    );
};

export interface ProductFlashCardProps {
    item: ProductItem;
    logId: string;
    kit: ProductAnswerKit;
    /** The release the product was given in (its other products follow, "याच टाकीत"). */
    box: ProductBox | undefined;
    /** The release's tank count and his words (`SavedGiven.tankWordsOf`). */
    words: TankWords | undefined;
    /** The talk it was told in (its other parts close the page); absent = none drawn. */
    talk: DayView | undefined;
    speaker: Who | undefined;
    /** The row it grows out of and snaps back into; absent = it simply opens. */
    from?: RowRect;
    onClose: () => void;
}

export const ProductFlashCard: React.FC<ProductFlashCardProps> = ({ item, logId, kit, box, words, talk, speaker, from, onClose }) => {
    const language = useOptionalLanguage()?.language;
    const F = finalResultWords(language).flash;
    const reduce = useRef(prefersReducedMotion()).current;
    const animated = !!from && !reduce;
    const [phase, setPhase] = useState<'from' | 'open' | 'closing'>(animated ? 'from' : 'open');
    const [target] = useState<RowRect>(fullRect);
    const [checking, setChecking] = useState<ProductItem | null>(null);
    const [checkStates, setCheckStates] = useState<Record<string, CheckState>>({});
    const [scrolled, setScrolled] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const closing = useRef(false);

    useLayoutEffect(() => {
        hapticFeedback.medium();
        if (phase !== 'from') return undefined;
        const id = requestAnimationFrame(() => setPhase('open'));
        return () => cancelAnimationFrame(id);
        // The grow runs once, from the row it was opened on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const snapBack = useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        hapticFeedback.light();
        if (!animated) { onClose(); return; }
        setPhase('closing');
        window.setTimeout(onClose, SNAP_MS);
    }, [animated, onClose]);
    useBackDismiss(!checking, snapBack);

    // The end of the page: once he scrolled to it and it stayed in view a moment, the card goes back by itself.
    useWhenInView(endRef, scrollRef, { threshold: 0.95, delayMs: 950, enabled: phase === 'open' && scrolled && !checking, onFire: snapBack });
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return undefined;
        const onScroll = () => { if (el.scrollTop > 30) setScrolled(true); };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    const items = box?.items.length ? [item, ...box.items.filter(i => i.id !== item.id)] : [item];
    const rect = phase === 'open' || !from ? target : from;
    const style: React.CSSProperties = {
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        borderRadius: phase === 'open' ? 28 : 12,
        transition: animated ? `left ${phase === 'closing' ? SNAP_MS : GROW_MS}ms cubic-bezier(.2,1.1,.35,1), top ${phase === 'closing' ? SNAP_MS : GROW_MS}ms cubic-bezier(.2,1.1,.35,1), width ${phase === 'closing' ? SNAP_MS : GROW_MS}ms cubic-bezier(.2,1.1,.35,1), height ${phase === 'closing' ? SNAP_MS : GROW_MS}ms cubic-bezier(.2,1.1,.35,1), border-radius ${GROW_MS}ms` : 'none',
    };
    const openCheck = (it: ProductItem) => { if (!checking) { hapticFeedback.medium(); setChecking(it); } };

    return (
        <div className="fixed inset-0 z-[55]" data-testid="vr2-product-flash" data-item={item.id} data-phase={phase} style={{ fontFamily: SANS }}>
            <button type="button" aria-hidden="true" tabIndex={-1} onClick={snapBack} data-testid="vr2-flash-backdrop"
                className={`absolute inset-0 bg-[rgba(30,16,60,0.45)] ${animated ? 'transition-opacity duration-300' : ''} ${phase === 'open' ? 'opacity-100' : 'opacity-0'}`} />
            <div role="dialog" aria-modal="true" aria-label={productName(item, language) || item.matchName || F.checkRow}
                className="absolute flex flex-col overflow-hidden border-2 border-[#C4B5FD] bg-white shadow-[0_24px_50px_rgba(30,16,60,0.35)]" style={style}>
                <div className="relative flex h-[46px] flex-none items-center justify-center">
                    <span className="h-[5px] w-[46px] rounded-[3px] bg-[#C4B5FD]" aria-hidden="true" />
                    <button type="button" onClick={snapBack} aria-label={F.close} data-testid="vr2-flash-close"
                        className="absolute right-2.5 top-1.5 grid h-9 w-9 place-items-center rounded-full border-[1.5px] border-[#E5E7E1] bg-white text-[#44403C]"><X size={18} aria-hidden="true" /></button>
                </div>
                <div ref={scrollRef} data-testid="vr2-flash-scroll"
                    className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3.5 pb-5 ${animated ? 'transition-opacity duration-200' : ''} ${phase === 'open' ? 'opacity-100' : 'opacity-0'}`}>
                    {items.map((it, i) => (
                        <React.Fragment key={it.id}>
                            {i > 0 && <div className="mt-2 flex items-center gap-2 text-[13.5px] font-extrabold text-[#5B21B6] before:h-[1.5px] before:flex-1 before:bg-[#DDD6FE] after:h-[1.5px] after:flex-1 after:bg-[#DDD6FE]" data-testid="vr2-flash-same-tank">{F.sameTank}</div>}
                            <ProductBlock item={it} logId={logId} kit={kit} box={box} words={words} speaker={speaker} scrollRef={scrollRef}
                                canPop={phase === 'open' && !checking} checkStates={checkStates} onOpenCheck={openCheck} testId={`vr2-pf-${it.id}`} />
                        </React.Fragment>
                    ))}
                    {talk && (
                        <>
                            <div className="mt-2 flex items-center gap-2 text-[13.5px] font-extrabold text-[#5B21B6] before:h-[1.5px] before:flex-1 before:bg-[#DDD6FE] after:h-[1.5px] after:flex-1 after:bg-[#DDD6FE]">{F.restOfTalk}</div>
                            <div data-testid="vr2-flash-rest"><SavedPartsGrid day={talk} look="rows" skip={['inputs']} /></div>
                        </>
                    )}
                    <div ref={endRef} className="flex items-center justify-center gap-3 px-2.5 pb-2 pt-4 text-[#5B21B6]" data-testid="vr2-flash-end">
                        <span className="text-[17px] font-extrabold leading-[1.3]">{F.endTitle}<small className="block text-[13px] font-bold text-[#57534E]">{F.endSub}</small></span>
                    </div>
                </div>
            </div>
            {checking && (
                <CheckCard item={checking} logId={logId} kit={kit} heard={words?.saidOf(checking) ?? []}
                    onDismiss={() => setChecking(null)}
                    onDone={s => { setCheckStates(c => ({ ...c, [checkKeyOf(logId, checking.id)]: s })); setChecking(null); }} />
            )}
        </div>
    );
};

export default ProductFlashCard;
