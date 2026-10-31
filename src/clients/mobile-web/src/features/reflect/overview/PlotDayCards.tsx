/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3; lane RF2 — the founder's screen 1, 2026-10-30)
 *
 * प्लॉटनिहाय काम — one wide card per picked plot for the chosen day, and (whole farm view) one "संपूर्ण शेत" card for
 * the work no plot card takes. Lane RF2: the eight numbered squares and their colour key are gone; each card shows ONLY
 * what actually happened that day, as chips in the result screen's part colours with each part's own icon
 * (`plotDayModel.dayChipsOf`), the money as one chip from the server ledger (tap → that day's money lens), and keeps
 * the plot's identity, the ONE status wording, "आज N वेळा सांगितलं", the water state and weather. An empty day says
 * "आज अजून काही सांगितलं नाही". Tapping a card opens the plot's day (`day/DaySheets.PlotDayView`).
 */
import React from 'react';
import { ChevronRight, Droplets, HelpCircle, IndianRupee, Map as MapIcon, Paperclip, Thermometer } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { CategoryIcon } from '../../logs/components/shramsathi/understandingRing';
import { PartIcon } from '../../logs/components/voiceResult/HisWords';
import { cropNameIn, partNameIn } from '../../logs/components/voiceResult/partNames';
import { partMeta } from '../../logs/components/voiceResult/resultModel';
import { StatusChip, useReflectCopy } from '../day/RecordingParts';
import { WATER_LABEL, type DayCardCore, type DayChip, type PlotDayCard, type WaterState } from './plotDayModel';
import { rupees } from './reflectDates';
import type { PlotRef } from './reflectSelection';
import { CropPhoto, Num, Tap } from './ui';
import { useLogAttachmentCount } from './useLogAttachmentCount';

const WATER_TONE: Record<WaterState, string> = { ON_TRACK: 'bg-green-100 text-green-800', MISSED: 'bg-orange-100 text-orange-800', EXTRA: 'bg-blue-100 text-blue-800' };
/** The result screen's खर्च colour, for the ledger's money chip. */
const MONEY_TINT = partMeta('expense').tint;

/** One thing that happened: its part's colour and icon, as said; an unsure one keeps its mark. */
export const Chip: React.FC<{ chip: DayChip }> = ({ chip }) => {
    const language = useOptionalLanguage()?.language;
    const copy = useReflectCopy();
    const blocker = chip.kind === 'blocker';
    const name = blocker ? copy.stoppage : partNameIn(chip.kind as Exclude<DayChip['kind'], 'blocker'>, language);
    const text = chip.text || name;
    return (
        <span data-testid={`chip-${chip.id}`} data-kind={chip.kind} data-verified={chip.verified ? 'yes' : 'no'}
            aria-label={[name, text === name ? '' : text, chip.verified ? '' : copy.unsure].filter(Boolean).join(': ')}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-xl px-2 py-1 text-[14.5px] font-extrabold text-stone-900 ${blocker ? 'bg-orange-50 ring-1 ring-orange-300' : ''} ${chip.verified ? '' : 'border border-dashed border-amber-500'}`}
            style={blocker ? undefined : { background: partMeta(chip.kind as Exclude<DayChip['kind'], 'blocker'>).tint }}>
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-white/65">
                {blocker ? <CategoryIcon name="blockers" size={18} /> : <PartIcon part={chip.kind as Exclude<DayChip['kind'], 'blocker'>} size={18} />}
            </span>
            <span className="min-w-0 line-clamp-2 leading-snug">{text}</span>
            {!chip.verified && <HelpCircle size={14} className="shrink-0 text-amber-600" aria-hidden="true" />}
        </span>
    );
};

/**
 * The chips of a day, the ledger's money last, labelled as the accounts' figure ("हिशोबातून", fix pass D5). A tap opens
 * the money lens on that very figure (a plot's day); a figure the lens cannot show as it is (the whole farm's: the lens
 * has no "no plot" view) is a plain chip, never a button that lands on a different number (review B008).
 */
const Chips: React.FC<{ card: DayCardCore; testKey: string; onCost?: () => void }> = ({ card, testKey, onCost }) => {
    const copy = useReflectCopy();
    const language = useOptionalLanguage()?.language;
    const money = card.money?.amount != null ? card.money : undefined;
    const inner = money && (
        <>
            <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-white/65"><IndianRupee size={16} aria-hidden="true" /></span>
            <Num>{rupees(money.amount as number)}</Num>
            <span className="text-[11.5px] font-bold text-stone-700" data-testid={`plot-money-source-${testKey}`}>{copy.fromLedger}</span>
            {money.partial.length > 0 && <span className="text-[11px] text-amber-800" data-testid={`plot-money-partial-${testKey}`}>· {copy.partialTag}</span>}
        </>
    );
    const label = money ? `${partNameIn('expense', language)} ${rupees(money.amount as number)} ${copy.fromLedger}` : '';
    const look = 'inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-[14.5px] font-extrabold text-stone-900';
    return (
        <span className="mt-2.5 flex flex-wrap gap-1.5" data-testid={`plot-chips-${testKey}`}>
            {card.chips.map(c => <Chip key={c.id} chip={c} />)}
            {money && (onCost
                ? <Tap onClick={e => { e.stopPropagation(); onCost(); }} data-testid={`plot-money-${testKey}`} aria-label={label} className={look} style={{ background: MONEY_TINT }}>{inner}</Tap>
                : <span data-testid={`plot-money-${testKey}`} data-tappable="no" aria-label={label} className={look} style={{ background: MONEY_TINT }}>{inner}</span>)}
        </span>
    );
};

/** "आज N वेळा सांगितलं" and the way into the day — or what an empty day says. */
const Foot: React.FC<{ card: DayCardCore; isToday: boolean; testKey: string }> = ({ card, isToday, testKey }) => {
    const copy = useReflectCopy();
    if (card.recordings === 0) {
        // Money from the accounts but nothing said: say exactly that (fix pass D5), never "nothing on this day".
        const line = card.money?.amount != null ? copy.nothingSpoken : copy.nothingTold(isToday);
        return <span className="mt-2.5 block text-[14px] font-bold text-stone-500" data-testid={`plot-empty-${testKey}`}>{line}</span>;
    }
    return (
        <span className="mt-2.5 flex items-center justify-between gap-2 text-[13px] font-bold text-stone-600">
            <span data-testid={`plot-times-${testKey}`}>{copy.timesTold(card.recordings, isToday)}</span>
            <span className="inline-flex items-center gap-0.5 font-extrabold text-emerald-700">{copy.seeAll}<ChevronRight size={16} aria-hidden="true" /></span>
        </span>
    );
};

/** A whole card is the button into its day (Enter / Space too). */
const CardButton: React.FC<{ testId: string; status: DayCardCore['status']; onOpen: () => void; children: React.ReactNode; edge?: string }> = ({ testId, status, onOpen, children, edge }) => {
    const tint = status === 'blocked' ? 'border-amber-200 bg-amber-50' : status === 'worked' ? 'border-emerald-200 bg-white' : 'border-stone-200 bg-white';
    return (
        <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
            data-testid={testId} data-status={status}
            className={`relative block w-full cursor-pointer rounded-[18px] border-2 p-3 pl-4 text-left transition-transform active:scale-[0.99] ${tint}`}>
            {edge && <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-[18px] ${edge}`} aria-hidden="true" />}
            {children}
        </div>
    );
};

const PlotDayCardView: React.FC<{ card: PlotDayCard; isToday: boolean; onOpen: (ref: PlotRef) => void; onCost?: (ref: PlotRef) => void }> = ({ card, isToday, onOpen, onCost }) => {
    const { ref, log } = card;
    const language = useOptionalLanguage()?.language;
    const files = useLogAttachmentCount(log?.id);
    const cropName = cropNameIn(ref.cropName, language);
    // spec I18 — the download fills a plot's variety with its crop's (English) name when the server has none
    // (`plotSchedule.ts`): that is not a variety. Show a variety only when it is not the crop again.
    const variety = ref.plot?.variety?.trim();
    const realVariety = variety && variety.toLowerCase() !== ref.cropName.trim().toLowerCase() && cropNameIn(variety, language) !== cropName ? variety : undefined;
    return (
        <CardButton testId={`plot-card-${ref.key}`} status={card.status} onOpen={() => onOpen(ref)} edge={ref.cropColor}>
            <span className="flex items-center gap-2.5">
                <CropPhoto iconName={ref.crop.iconName} name={ref.cropName} px={44} />
                <span className="min-w-0 flex-1">
                    <span className="block text-[18px] font-extrabold leading-tight text-stone-900">{ref.plotName ?? (cropName || ref.cropName)}</span>
                    <span className="block text-[13px] font-bold text-stone-500">{[cropName, realVariety, card.area, card.dayLabel].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                    {card.confirmed !== undefined && <StatusChip confirmed={card.confirmed} testId={`plot-state-${ref.key}`} />}
                    {files > 0 && <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[12px] font-bold text-blue-700 ring-1 ring-blue-100" aria-label={`जोडलेल्या फाइल ${files}`} data-testid={`plot-files-${ref.key}`}><Paperclip size={12} aria-hidden="true" /><Num>{files}</Num></span>}
                </span>
            </span>
            <Chips card={card} testKey={ref.key} onCost={onCost ? () => onCost(ref) : undefined} />
            {(card.water || card.weather) && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                    {card.water && <span className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-extrabold ${WATER_TONE[card.water]}`}><Droplets size={13} aria-hidden="true" />{WATER_LABEL[card.water]}</span>}
                    {card.weather && <span className="flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[12.5px] font-bold text-sky-800 ring-1 ring-sky-100"><Thermometer size={13} aria-hidden="true" /><Num>{card.weather.temp}</Num> · {card.weather.condition}</span>}
                </span>
            )}
            <Foot card={card} isToday={isToday} testKey={ref.key} />
        </CardButton>
    );
};

/** The "संपूर्ण शेत" card — whole-farm work, the same look. */
export const FarmDayCardView: React.FC<{ card: DayCardCore; isToday: boolean; onOpen: () => void }> = ({ card, isToday, onOpen }) => {
    const copy = useReflectCopy();
    return (
        <CardButton testId="plot-card-farm" status={card.status} onOpen={onOpen} edge="bg-emerald-700">
            <span className="flex items-center gap-2.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800" aria-hidden="true"><MapIcon size={22} /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[18px] font-extrabold leading-tight text-stone-900">{copy.wholeFarm}</span>
                    <span className="block text-[13px] font-bold text-stone-500">{copy.farmCardLine}</span>
                </span>
                {card.confirmed !== undefined && <StatusChip confirmed={card.confirmed} testId="plot-state-farm" />}
            </span>
            <Chips card={card} testKey="farm" />
            <Foot card={card} isToday={isToday} testKey="farm" />
        </CardButton>
    );
};

export const PlotDayCards: React.FC<{
    cards: readonly PlotDayCard[];
    /** The whole farm's card (only when the page shows the whole farm). */
    farm?: DayCardCore;
    isToday: boolean;
    onOpen: (ref: PlotRef) => void;
    onOpenFarm?: () => void;
    onCost?: (ref: PlotRef) => void;
}> = ({ cards, farm, isToday, onOpen, onOpenFarm, onCost }) => (
    <div className="space-y-2.5" data-testid="plot-day-cards">
        {cards.map(c => <PlotDayCardView key={c.ref.key} card={c} isToday={isToday} onOpen={onOpen} onCost={onCost} />)}
        {farm && onOpenFarm && <FarmDayCardView card={farm} isToday={isToday} onOpen={onOpenFarm} />}
    </div>
);
