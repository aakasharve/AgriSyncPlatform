/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b) — how sprays and fertilisers look on the result screen,
 * from the founder's design (`ProductCard.tsx`, founder 2026-10-24: "the products given together must LOOK together,
 * each box only as big as its text"):
 *   - `AddedProducts`: in "यातून काय समजलं", every product of this recording on ONE compact chip row;
 *   - `ProductBoxCard`: one box per spray / drip release — a header with only what he said about it (its water), then
 *     ONE tight row per product: his word on the left, the amount on the right.
 * What the design shows and this does not, on purpose: no "मात्रा सांगितली नाही" / "किती पाण्यात" notes (only what was said is shown)
 * and no time or area (no such field in the record). Lane IT4 added the library's identity: the Option 3 rows (`ProductRow`,
 * `ProductTank`) and the card they open (`ProductCard`); `AddedProducts` and `ProductBoxCard` stay for the screens that show no answers.
 */
import React from 'react';
import { Camera, ChevronRight, CircleDot, CircleHelp, Clock, Droplets, FlaskConical, ShieldCheck, SprayCan, UserCheck, Waves, X } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { amountText, nameIsPhrase, productName, type ProductBox, type ProductItem, type ProductWater } from './productModel';
import { inputWords } from '../../../../domain/inputs/inputWords';
import { ingredientLine, type ProductAnswerKit } from './ProductCard';
import { answersOf, identityOf, statusOf, TYPE_STYLE, typeKeyOf, type ItemStatus } from './inputIdentityModel';
import { resultCopy, type ResultCopy } from './resultCopy';

const SANS = "'Noto Sans Devanagari', sans-serif";

/** A product the screen can show: a name in this language, or at least the amount he said. */
interface Shown { id: string; name: string; amount: string }

const shownOf = (boxes: readonly ProductBox[], language: string | undefined): Shown[] =>
    boxes.flatMap(b => b.items)
        // His whole phrase standing for the name already holds the amount he said: not repeated beside it.
        .map(i => ({ id: i.id, name: productName(i, language), amount: nameIsPhrase(i, language) ? '' : amountText(i.amount, language) }))
        .filter(p => p.name || p.amount);

/** His words for the water, else the number(s) exactly as recorded (the screen's own digits, as everywhere on it). */
const waterText = (w: ProductWater, copy: ResultCopy): string =>
    w.spoken ?? [w.litres ? copy.litres(String(w.litres)) : '', w.hours ? copy.hours(String(w.hours)) : ''].filter(Boolean).join(' · ');

/** "यातून काय समजलं": all the products of this recording on one row (design `AddedProducts`). */
export const AddedProducts: React.FC<{ boxes: readonly ProductBox[] }> = ({ boxes }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const shown = shownOf(boxes, language);
    if (shown.length === 0) return null;
    return (
        <div className="flex items-start gap-2.5 rounded-xl border-l-4 border-violet-500 bg-violet-50 p-2" data-testid="vr-added-products" style={{ fontFamily: SANS }}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-200"><FlaskConical size={20} className="text-violet-950" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
                <div className="text-[12px] font-extrabold text-stone-700">{copy.products}</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {shown.map(p => (
                        <span key={p.id} data-testid="vr-product-chip"
                            className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-white px-2 py-0.5 text-[14px] font-bold text-stone-900">
                            {[p.name, p.amount].filter(Boolean).join(' · ')}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
};

const KIND_ICON = { spray: SprayCan, drip: Waves, other: FlaskConical } as const;

/** One spray / drip release as ONE box (design `ProductGroup`): its water once, then one row per product. */
export const ProductBoxCard: React.FC<{ box: ProductBox }> = ({ box }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const shown = shownOf([box], language);
    if (shown.length === 0) return null;
    const Icon = KIND_ICON[box.kind];
    const water = box.water.map(w => waterText(w, copy)).filter(Boolean);
    return (
        <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white" data-testid={`vr-product-box-${box.id}`} data-kind={box.kind} style={{ fontFamily: SANS }}>
            <header className="bg-violet-50 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-700 text-white"><Icon size={16} aria-hidden="true" /></span>
                    <span className="text-[16px] font-extrabold text-violet-950">{box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products}</span>
                </div>
                {water.length > 0 && (
                    <p className="m-0 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="inline-flex items-center gap-1 text-[13px] font-bold text-stone-800" data-testid="vr-product-water">
                            <Droplets size={14} className="text-sky-700" aria-hidden="true" />{copy.water}: {water.join(' · ')}
                        </span>
                    </p>
                )}
            </header>
            <ul className="m-0 list-none divide-y divide-stone-200 p-0">
                {shown.map(p => (
                    <li key={p.id} className="flex items-baseline justify-between gap-2 border-l-4 border-violet-400 py-1.5 pl-2 pr-2.5" data-testid="vr-product-row">
                        <span className="min-w-0 text-[18px] font-extrabold leading-tight text-stone-900">{p.name}</span>
                        {p.amount && <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-[15px] font-extrabold text-stone-900" data-testid="vr-product-amount">{p.amount}</span>}
                    </li>
                ))}
            </ul>
        </section>
    );
};

// ===================================================================================================================
// Lane IT4 Task 2 (spec dfes-input-truth-and-mix-check-2026-11-06; founder 2026-11-06 Option 3 of DFES-result-options.html):
// ONE big coloured row per product - its name, its type pill, its ingredient, the amount HE said, and a status. One tap
// opens the bottom card (`ProductCard`). The colours are the founder's: बुरशीनाशक sky, कीटकनाशक pink, तणनाशक orange,
// वाढ नियंत्रक emerald, खत violet, unknown dashed stone.
// ===================================================================================================================

/** The status line of a row, in words and with its icon. Real names only (never "तुम्ही"). */
export const statusWords = (status: ItemStatus, kit: ProductAnswerKit, language: string | undefined): { text: string; tone: string; icon: 'shield' | 'camera' | 'help' | 'ask' | 'clock' | 'user' | 'x' } | null => {
    const copy = resultCopy(language);
    const words = inputWords(language === 'en' ? 'en' : 'mr');
    switch (status.kind) {
        case 'plain':
            return null;
        case 'notFound':
            return status.photo ? { text: words.photoKept, tone: 'text-emerald-800', icon: 'camera' } : { text: words.notFound, tone: 'text-stone-600', icon: 'help' };
        case 'ambiguous':
            return status.photo ? { text: words.photoKept, tone: 'text-emerald-800', icon: 'camera' } : { text: copy.ambiguousLine, tone: 'text-stone-600', icon: 'help' };
        case 'ask':
            return { text: copy.statusAsk, tone: 'text-amber-800', icon: 'ask' };
        case 'ownerWillCheck':
            return { text: copy.statusOwnerWillCheck, tone: 'text-stone-600', icon: 'clock' };
        case 'checked': {
            const who = kit.nameOfUser(status.byUserId);
            return status.verdict === 'confirmed' ? { text: copy.checkedYes(who), tone: 'text-emerald-800', icon: 'shield' }
                : status.verdict === 'rejected' ? { text: copy.checkedNo(who), tone: 'text-stone-600', icon: 'x' }
                    : { text: copy.checkedPhoto(who), tone: 'text-emerald-800', icon: 'camera' };
        }
        case 'said': {
            const who = kit.nameOfUser(status.byUserId);
            return status.verdict === 'confirmed' ? { text: copy.saidYes(who), tone: 'text-sky-800', icon: 'user' }
                : status.verdict === 'rejected' ? { text: copy.saidNo(who), tone: 'text-stone-600', icon: 'x' }
                    : { text: words.photoKept, tone: 'text-sky-800', icon: 'camera' };
        }
    }
};

const STATUS_ICON = { shield: ShieldCheck, camera: Camera, help: CircleHelp, ask: CircleDot, clock: Clock, user: UserCheck, x: X } as const;

export interface ProductRowProps {
    item: ProductItem;
    logId: string;
    kit: ProductAnswerKit;
    onOpen: (item: ProductItem, logId: string) => void;
}

/** One product as ONE big coloured row (Option 3). */
export const ProductRow: React.FC<ProductRowProps> = ({ item, logId, kit, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const identity = identityOf(item);
    const key = typeKeyOf(identity);
    const style = TYPE_STYLE[key];
    const answers = answersOf(kit.logById.get(logId), item.ref);
    const rawStatus = statusOf(identity, item, answers, kit.canCheck);
    const status = statusWords(rawStatus, kit, language);
    const Icon = status ? STATUS_ICON[status.icon] : null;
    const name = productName(item, language) || (item.matchName ?? '');
    const amount = nameIsPhrase(item, language) ? '' : amountText(item.amount, language);
    const ingredient = ingredientLine(identity, language);
    return (
        <button type="button" onClick={() => onOpen(item, logId)} data-testid={`vr-prow-${item.id}`} data-type={key}
            className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-l-[6px] ${style.edge} ${style.soft} px-3 py-2 text-left ${key === 'unknown' ? 'border-2 border-dashed border-stone-300' : ''}`}>
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[18px] font-extrabold text-stone-900" data-testid="vr-prow-name">{name}</span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-extrabold ring-1 ${style.pill}`} data-testid="vr-prow-type">{copy.typeNames[key]}</span>
                </span>
                {ingredient && <span className="mt-0.5 block text-[15px] font-bold text-stone-800" data-testid="vr-prow-ingredient">{ingredient}</span>}
                {status && Icon && (
                    <span className={`mt-0.5 flex items-center gap-1 text-[14px] font-extrabold ${status.tone}`} data-testid="vr-prow-status"
                        data-status={rawStatus.kind} data-verdict={'verdict' in rawStatus ? rawStatus.verdict : undefined}>
                        <Icon size={16} aria-hidden="true" />{status.text}
                    </span>
                )}
            </span>
            {amount && <span className="shrink-0 text-[15px] font-extrabold text-stone-700" data-testid="vr-prow-amount">{amount}</span>}
            <ChevronRight size={20} className="shrink-0 text-stone-400" aria-hidden="true" />
        </button>
    );
};

/** One spray / drip release: its water once, then one big row per product (Option 3). */
export const ProductTank: React.FC<{ box: ProductBox; logId: string; kit: ProductAnswerKit; onOpen: ProductRowProps['onOpen'] }> = ({ box, logId, kit, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const items = box.items.filter(i => productName(i, language) || amountText(i.amount, language));
    if (items.length === 0) return null;
    const water = box.water.map(w => waterText(w, copy)).filter(Boolean);
    const Icon = KIND_ICON[box.kind];
    return (
        <section className="rounded-2xl border-2 border-violet-300 bg-white p-2.5" data-testid={`vr-tank-${box.id}`} data-kind={box.kind} style={{ fontFamily: SANS }}>
            <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100"><Icon size={20} className="text-violet-800" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                    <div className="text-[16px] font-extrabold text-stone-900">{box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products}</div>
                    {water.length > 0 && <div className="text-[13px] font-bold text-stone-600" data-testid="vr-product-water">{copy.water}: {water.join(' · ')}</div>}
                </div>
            </div>
            <div className="mt-2 space-y-2">
                {items.map(i => <ProductRow key={i.id} item={i} logId={logId} kit={kit} onOpen={onOpen} />)}
            </div>
        </section>
    );
};
