/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — one spray / drip release and its products as the approved design draws
 * them (`.ptank`, `.pth`, `.prow` with its type colours): the release's icon, name and water once, then one coloured row per product
 * — its name, the white type pill, its ingredient, the amount HE said, "›". One tap opens the product card.
 *
 * Every word is read from the record and the library exactly as the result screen's rows read them (`ProductRow`: identity, type,
 * ingredient, amount, the answer status line); nothing is worked out here (P4, P7). The status line ("मालक तपासतील", "… म्हणाले हो")
 * stays under the ingredient — the design's demo has none, the record does.
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — optional, for the final design: HIS words under each product
 * (`said`), and the release drawn as a row of "यातून काय समजलं" with its tank count (`look="row"`, `words`). Without them: as before.
 */
import React from 'react';
import { Camera, CircleDot, CircleHelp, Clock, ShieldCheck, UserCheck, X } from 'lucide-react';
import { nearProducts } from '../../../../domain/inputs/nearNames';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { answersOf, identityOf, isAnswerable, nameForMatching, statusOf, TYPE_STYLE, typeKeyOfItem, type TypeKey } from '../voiceResult/inputIdentityModel';
import { ingredientLine, type ProductAnswerKit } from '../voiceResult/ProductCard';
import { statusWords } from '../voiceResult/ProductRows';
import { amountText, nameIsPhrase, productName, type ProductBox, type ProductItem, type ProductWater } from '../voiceResult/productModel';
import { resultCopy, type ResultCopy } from '../voiceResult/resultCopy';
import { PartIcon } from '../voiceResult/HisWords';
import { partMeta } from '../voiceResult/resultModel';
import { finalResultWords } from './finalResultWords';
import { SaidLine, SANS } from './savedBits';

/** The औषध / खत part's tint (his words for a product are tinted like it, as in his words above). */
const INPUTS_TINT = partMeta('inputs').tint;

/** The design's pill text colours (`.ty-insecticide em` …), and the same family for the types the demo does not show. */
const PILL_INK: Record<TypeKey, string> = {
    insecticide: 'text-[#9D174D]', fungicide: 'text-[#075985]', fertilizer: 'text-[#5B21B6]',
    herbicide: 'text-orange-800', pgr: 'text-emerald-800', unknown: 'text-stone-600',
};

const STATUS_ICON = { shield: ShieldCheck, camera: Camera, help: CircleHelp, ask: CircleDot, clock: Clock, user: UserCheck, x: X } as const;

/** His words for the water, else the number(s) exactly as recorded (the result screen's rule). */
const waterText = (w: ProductWater, copy: ResultCopy, language: string | undefined): string =>
    w.spoken !== undefined ? digitsFor(w.spoken, language)
        : [w.litres ? copy.litres(digitsFor(w.litres, language)) : '', w.hours ? copy.hours(digitsFor(w.hours, language)) : ''].filter(Boolean).join(' · ');

/** The design's spray can and drip waves. */
const KindIcon: React.FC<{ kind: ProductBox['kind'] }> = ({ kind }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {kind === 'drip'
            ? <path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
            : <path d="M9 3h6M10 3v3M14 3v3M7 9h10l-1 12H8L7 9zM17 11h3M17 14h4" />}
    </svg>
);

export interface SavedProductRowProps {
    item: ProductItem;
    logId: string;
    kit: ProductAnswerKit;
    onOpen: (item: ProductItem, logId: string) => void;
    /** His own words for this product, exactly as in his transcript (the final design's `.prod .said`). Absent / empty = none drawn. */
    said?: readonly string[];
}

/** One product (`.prow`). Same reading of the record as `ProductRow`, same testids. */
export const SavedProductRow: React.FC<SavedProductRowProps> = ({ item, logId, kit, onOpen, said }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const answers = answersOf(kit.logById.get(logId), item.ref);
    const identity = identityOf(item, answers);
    const key = typeKeyOfItem(item, identity);
    const style = TYPE_STYLE[key];
    const rawStatus = statusOf(identity, item, answers, kit.canCheck);
    const hasNear = rawStatus.kind === 'notFound' && !rawStatus.photo && isAnswerable(item) && nearProducts(nameForMatching(item)).length > 0;
    const chose = identity.state === 'found' && identity.byPick && rawStatus.kind === 'said' && rawStatus.verdict === 'confirmed';
    const status = hasNear ? { text: copy.didYouMeanRow, tone: 'text-sky-800', icon: 'ask' as const }
        : chose && rawStatus.kind === 'said' ? { text: copy.speakerChose(kit.nameOfUser(rawStatus.byUserId)), tone: 'text-sky-800', icon: 'user' as const }
            : statusWords(rawStatus, kit, language);
    const Icon = status ? STATUS_ICON[status.icon] : null;
    const name = productName(item, language) || (item.matchName ?? '');
    const amount = nameIsPhrase(item, language) ? '' : amountText(item.amount, language, true);
    const ingredient = ingredientLine(identity, language);
    return (
        <button type="button" onClick={() => onOpen(item, logId)} data-testid={`vr-prow-${item.id}`} data-type={key}
            className={`flex min-h-[64px] w-full items-center gap-2.5 rounded-[14px] border-l-[6px] ${style.edge} ${style.soft} px-2.5 py-2 text-left text-[#1C1917] active:scale-[0.99] ${key === 'unknown' ? 'border-2 border-dashed border-stone-300' : ''}`}>
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-[17px] font-extrabold" data-testid="vr-prow-name">{name}</b>
                    {key !== 'unknown' && <em className={`rounded-full bg-white px-[9px] py-px text-[12px] font-extrabold not-italic shadow-[inset_0_0_0_1px_currentColor] ${PILL_INK[key]}`} data-testid="vr-prow-type">{copy.typeNames[key]}</em>}
                </span>
                {ingredient && <span className="mt-px block text-[14px] font-bold text-[#44403C]" data-testid="vr-prow-ingredient">{ingredient}</span>}
                {status && Icon && (
                    <span className={`mt-px flex items-center gap-1 text-[12.5px] font-extrabold ${status.tone}`} data-testid="vr-prow-status"
                        data-status={rawStatus.kind} data-verdict={'verdict' in rawStatus ? rawStatus.verdict : undefined}>
                        <Icon size={14} aria-hidden="true" />{status.text}
                    </span>
                )}
                {said && <SaidLine quotes={said} tint={INPUTS_TINT} className="mt-[3px]" testId={`vr-prow-said-${item.id}`} />}
            </span>
            {amount && <span className="flex-none text-[15px] font-extrabold text-[#44403C]" data-testid="vr-prow-amount">{amount}</span>}
            <span className="flex-none text-[22px] leading-none text-[#A8A29E]" aria-hidden="true">›</span>
        </button>
    );
};

/** A product with nothing to answer with (no kit): the same row, not a button. */
const PlainRow: React.FC<{ item: ProductItem; said?: readonly string[] }> = ({ item, said }) => {
    const language = useOptionalLanguage()?.language;
    const name = productName(item, language);
    const amount = nameIsPhrase(item, language) ? '' : amountText(item.amount, language, true);
    return (
        <div className="flex min-h-[56px] items-center gap-2.5 rounded-[14px] border-l-[6px] border-l-violet-400 bg-violet-50 px-2.5 py-2 text-[#1C1917]" data-testid="vr-product-row">
            <span className="min-w-0 flex-1">
                <b className="block text-[17px] font-extrabold">{name}</b>
                {said && <SaidLine quotes={said} tint={INPUTS_TINT} className="mt-[3px]" testId={`vr-prow-said-${item.id}`} />}
            </span>
            {amount && <span className="flex-none text-[15px] font-extrabold text-[#44403C]" data-testid="vr-product-amount">{amount}</span>}
        </div>
    );
};

/** The final design's extras for one release (B1): its tank count and his words; absent = the release as before. */
export interface TankWords {
    /** The tank count the record or his words hold (`tankFacts.tankCountOf`); null = no count is drawn (never a made-up one). */
    tanks: number | null;
    /** His words for the release (its water, its tanks), exactly as in his transcript. */
    said: readonly string[];
    /** His words for each product. */
    saidOf: (item: ProductItem) => readonly string[];
}

export interface SavedTankProps {
    box: ProductBox;
    /** The log the products ride on; with no answer kit the rows are not buttons. */
    logId: string;
    kit?: ProductAnswerKit;
    onOpen: SavedProductRowProps['onOpen'];
    /**
     * `box` (default): the violet release box, as before. `row` (the final design, result-v12-final.html `.ar2` under "यातून काय
     * समजलं"): the emerald row, "औषध / खत" small, the release and its tank count big ("फवारणी · ३ टाक्या"), the water under it, his
     * words, then the products.
     */
    look?: 'box' | 'row';
    words?: TankWords;
}

/** One release (`.ptank`): its icon, its name and water once, then its products. */
export const SavedTank: React.FC<SavedTankProps> = ({ box, logId, kit, onOpen, look = 'box', words }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const items = box.items.filter(i => productName(i, language) || amountText(i.amount, language, true));
    if (items.length === 0) return null;
    const water = box.water.map(w => waterText(w, copy, language)).filter(Boolean);
    const kindName = box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products;
    const rows = items.map(i => (kit
        ? <SavedProductRow key={i.id} item={i} logId={logId} kit={kit} onOpen={onOpen} said={words?.saidOf(i)} />
        : <PlainRow key={i.id} item={i} said={words?.saidOf(i)} />));
    if (look === 'row') {
        const tanks = words?.tanks ?? null;
        return (
            <section className="flex flex-col gap-2 rounded-xl border-l-[6px] border-l-[#059669] bg-[#ECFDF5] p-2.5 text-[#1C1917]"
                data-testid={kit ? `vr-tank-${box.id}` : `vr-product-box-${box.id}`} data-kind={box.kind} data-look="row" style={{ fontFamily: SANS }}>
                <div className="flex items-center gap-2.5">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-xl" style={{ background: INPUTS_TINT }}><PartIcon part="inputs" size={24} /></span>
                    <span className="min-w-0 flex-1">
                        <small className="block text-[13px] font-semibold leading-[1.3] text-[#57534E]">{copy.products}</small>
                        <b className="block text-[22px] font-extrabold leading-[1.25] [overflow-wrap:anywhere]" data-testid="vr-tank-value">
                            {kindName}{tanks !== null && <span data-testid="vr-tank-count" data-count={tanks}> · {finalResultWords(language).tanks(tanks)}</span>}
                        </b>
                        {water.length > 0 && <span className="block text-[14px] font-bold leading-[1.35] text-[#44403C]" data-testid="vr-product-water">{copy.water}: {water.join(' · ')}</span>}
                    </span>
                </div>
                {words && <SaidLine quotes={words.said} tint={INPUTS_TINT} className="ml-[50px]" testId={`vr-tank-said-${box.id}`} />}
                {rows}
            </section>
        );
    }
    return (
        <section className="mt-1.5 flex flex-col gap-[7px] rounded-2xl border-2 border-[#C4B5FD] p-2" data-testid={kit ? `vr-tank-${box.id}` : `vr-product-box-${box.id}`}
            data-kind={box.kind} style={{ fontFamily: SANS }}>
            <div className="flex items-center gap-2.5">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-[#EDE9FE] text-[#5B21B6]"><KindIcon kind={box.kind} /></span>
                <div className="min-w-0">
                    <b className="block text-[15.5px] font-extrabold">{kindName}</b>
                    {water.length > 0 && <small className="block text-[12.5px] font-bold text-[#5F6B63]" data-testid="vr-product-water">{copy.water}: {water.join(' · ')}</small>}
                </div>
            </div>
            {rows}
        </section>
    );
};
