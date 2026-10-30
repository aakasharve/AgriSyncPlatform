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
 * What the design shows and this does not, on purpose: no identity states ("ओळख", "कदाचित" — there is no product
 * master yet), no "मात्रा सांगितली नाही" / "किती पाण्यात" notes (only what was said is shown), no time or area (no
 * such field in the record), and no photo / speak offer for unknown products (no identity, so no "unknown").
 */
import React from 'react';
import { Droplets, FlaskConical, SprayCan, Waves } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { amountText, nameIsPhrase, productName, type ProductBox, type ProductWater } from './productModel';
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
