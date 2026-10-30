/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * प्लॉटनिहाय काम — one wide card per picked plot for the chosen day (on a phone, two side by side cut the
 * plot's name short). Every fact the old CompactCropCard carried is here (see `plotDayModel.ts`): the crop
 * colour on the edge, crop + plot, the trust mark, attached files, the day's money (tap → that day's money
 * lens), the first note, weather, the season day, the water state, the stop reason, and the EIGHT
 * colour-coded counts — now each with a word in the key under the cards. Tapping a card opens that day's
 * record (or the "nothing recorded — add it" view), as before.
 *
 * Counts: "—" when nothing was recorded in a bucket; a labour bucket told WITHOUT a number keeps its colour
 * and shows "—" ("we were not told"), never a 0. Every Marathi string is PROPOSED.
 *
 * Lane RF: the trust mark is the page's ONE status wording ("पक्कं नाही" / "✔ पक्कं केलं"); the money is the server
 * ledger's for that plot that day, marked partial when it is; "N वेळा सांगितलं" when the day was told more than once;
 * tapping the card opens the plot's day sheet (every recording of it).
 */
import React from 'react';
import { Ban, Bell, CheckSquare, Droplets, IndianRupee, Package, Paperclip, StickyNote, Thermometer, Tractor, Users } from 'lucide-react';
import { StatusChip, useReflectCopy } from '../day/RecordingParts';
import { BUCKETS, BUCKET_COLOR, BUCKET_LABEL, WATER_LABEL, type Bucket, type PlotDayCard, type WaterState } from './plotDayModel';
import { rupees } from './reflectDates';
import type { PlotRef } from './reflectSelection';
import { CropPhoto, Num, Tap } from './ui';
import { useLogAttachmentCount } from './useLogAttachmentCount';

const ICON: Record<Bucket, React.ReactNode> = {
    work: <CheckSquare size={15} aria-hidden="true" />, water: <Droplets size={15} aria-hidden="true" />, labour: <Users size={15} aria-hidden="true" />,
    inputs: <Package size={15} aria-hidden="true" />, machine: <Tractor size={15} aria-hidden="true" />, cost: <IndianRupee size={15} aria-hidden="true" />,
    notes: <StickyNote size={15} aria-hidden="true" />, reminders: <Bell size={15} aria-hidden="true" />,
};
const WATER_TONE: Record<WaterState, string> = { ON_TRACK: 'bg-green-100 text-green-800', MISSED: 'bg-orange-100 text-orange-800', EXTRA: 'bg-blue-100 text-blue-800' };

const BucketCell: React.FC<{ b: Bucket; n: number | undefined; amber: boolean }> = ({ b, n, amber }) => {
    const unknown = n === undefined;
    const has = unknown || n > 0;
    const color = !has ? 'bg-stone-50 text-stone-300 ring-stone-100' : amber ? 'bg-amber-50 text-amber-700 ring-amber-200' : BUCKET_COLOR[b];
    const said = unknown ? 'संख्या सांगितली नाही' : n > 0 ? String(n) : 'नोंद नाही';
    return (
        <span data-bucket={b} data-count={unknown ? 'unknown' : n} aria-label={`${BUCKET_LABEL[b]}: ${said}`} title={BUCKET_LABEL[b]}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 ring-1 ${color}`}>
            {ICON[b]}<Num className="text-[12.5px] font-extrabold leading-none">{!unknown && n > 0 ? n : '—'}</Num>
        </span>
    );
};

const PlotDayCardView: React.FC<{ card: PlotDayCard; isToday: boolean; onOpen: (ref: PlotRef) => void; onCost?: (ref: PlotRef) => void }> = ({ card, isToday, onOpen, onCost }) => {
    const { ref, log } = card;
    const copy = useReflectCopy();
    const files = useLogAttachmentCount(log?.id);
    const tint = card.status === 'blocked' ? 'border-amber-200 bg-amber-50' : card.status === 'worked' ? 'border-emerald-200 bg-white' : 'border-stone-200 bg-rose-50/30';
    const open = () => onOpen(ref);
    return (
        <div role="button" tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
            data-testid={`plot-card-${ref.key}`} data-status={card.status}
            className={`relative block w-full cursor-pointer rounded-2xl border-2 p-3 pl-4 text-left transition-transform active:scale-[0.99] ${tint}`}>
            <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-2xl ${ref.cropColor}`} aria-hidden="true" />
            <span className="flex items-center gap-2.5">
                <CropPhoto iconName={ref.crop.iconName} name={ref.cropName} px={44} />
                <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-extrabold leading-tight text-stone-900">{ref.plotName ?? ref.cropName}</span>
                    <span className="block text-[13px] font-bold text-stone-500">{[ref.cropName, ref.plot?.variety, card.area, ref.plotName ? undefined : 'प्लॉट नाही'].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                    {card.confirmed !== undefined && <StatusChip confirmed={card.confirmed} testId={`plot-state-${ref.key}`} />}
                    {files > 0 && <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[12px] font-bold text-blue-700 ring-1 ring-blue-100" aria-label={`जोडलेल्या फाइल ${files}`} data-testid={`plot-files-${ref.key}`}><Paperclip size={12} aria-hidden="true" /><Num>{files}</Num></span>}
                    {card.money?.amount != null && onCost && (
                        <Tap onClick={e => { e.stopPropagation(); onCost(ref); }} data-testid={`plot-money-${ref.key}`} aria-label={`या दिवसाचा खर्च ${rupees(card.money.amount)}`}
                            className="rounded-full bg-emerald-50 px-2 py-1 text-[13px] font-extrabold text-emerald-800 ring-1 ring-emerald-200">
                            <Num>{rupees(card.money.amount)}</Num>
                            {card.money.partial.length > 0 && <span className="ml-1 text-[11px] text-amber-800" data-testid={`plot-money-partial-${ref.key}`}>· {copy.partialTag}</span>}
                        </Tap>
                    )}
                </span>
            </span>
            {card.note && <span className="mt-2 block rounded-lg bg-amber-50 px-2 py-1 text-[13px] font-bold text-amber-800 ring-1 ring-amber-100" data-testid={`plot-note-${ref.key}`}>{card.note}</span>}
            <span className="mt-2 flex flex-wrap gap-1.5">
                {card.recordings > 1 && <span className="rounded-lg bg-stone-100 px-2 py-1 text-[12.5px] font-extrabold text-stone-700" data-testid={`plot-times-${ref.key}`}>{copy.timesTold(card.recordings)}</span>}
                {card.dayLabel && <span className={`rounded-lg px-2 py-1 text-[12.5px] font-extrabold ${card.phase === 'CROP_CYCLE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{card.dayLabel}</span>}
                {card.water && <span className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-extrabold ${WATER_TONE[card.water]}`}><Droplets size={13} aria-hidden="true" />{WATER_LABEL[card.water]}</span>}
                {card.weather && <span className="flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[12.5px] font-bold text-sky-800 ring-1 ring-sky-100"><Thermometer size={13} aria-hidden="true" /><Num>{card.weather.temp}</Num> · {card.weather.condition}</span>}
            </span>
            <span className="mt-2.5 block">
                {card.status === 'blocked' ? (
                    <span className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-100 p-2 text-[14px] font-extrabold text-amber-800"><Ban size={16} aria-hidden="true" />काम थांबलं{card.stoppedReason ? `: ${card.stoppedReason}` : ''}</span>
                ) : card.counts ? (
                    <span className="grid grid-cols-8 gap-1">
                        {BUCKETS.map(b => <BucketCell key={b} b={b} n={card.counts![b]} amber={b === 'water' && card.waterBlocked} />)}
                    </span>
                ) : (
                    <span className="block rounded-lg bg-white/70 p-2 text-center text-[13px] font-bold text-stone-500 ring-1 ring-stone-200" data-testid={`plot-empty-${ref.key}`}>{isToday ? 'आज अजून काही सांगितलं नाही' : 'या दिवशी नोंद नाही'}</span>
                )}
            </span>
        </div>
    );
};

export const PlotDayCards: React.FC<{ cards: readonly PlotDayCard[]; isToday: boolean; onOpen: (ref: PlotRef) => void; onCost?: (ref: PlotRef) => void }> = ({ cards, isToday, onOpen, onCost }) => (
    <div className="space-y-2.5" data-testid="plot-day-cards">
        {cards.map(c => <PlotDayCardView key={c.ref.key} card={c} isToday={isToday} onOpen={onOpen} onCost={onCost} />)}
    </div>
);

/** Which colour is which: the old cards had icons only. */
export const BucketKey: React.FC = () => (
    <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="bucket-key">
        {BUCKETS.map(b => (
            <span key={b} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-extrabold ring-1 ${BUCKET_COLOR[b]}`}>{ICON[b]}{BUCKET_LABEL[b]}</span>
        ))}
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-50 px-2 py-1 text-[12px] font-extrabold text-stone-500 ring-1 ring-stone-200">— = नोंद नाही</span>
    </div>
);
