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
 *
 * Lane UI-9a (founder pick overview C, 2026-11-20: "if same crop is more than 3 times it should only show one image"): a crop with 4 or
 * more cards on screen shows its photo ONCE in a header and its plots as two small cards across - the crop's colour edge, the plot's name
 * and number, ONE status in words (all from what the card already holds) and, where the full card would show "अजून सांगा", a small mic. A tap
 * anywhere else opens the plot's day, as before. A crop with 1 to 3 cards keeps today's full card with its photo.
 */
import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, ChevronUp, Droplets, HelpCircle, IndianRupee, Map as MapIcon, Mic, Paperclip, Thermometer, User } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { CategoryIcon } from '../../logs/components/shramsathi/understandingRing';
import { PartIcon } from '../../logs/components/voiceResult/HisWords';
import { cropNameIn, partNameIn } from '../../logs/components/voiceResult/partNames';
import { partMeta } from '../../logs/components/voiceResult/resultModel';
import { StatusChip, useReflectCopy } from '../day/RecordingParts';
import { WATER_LABEL, type DayCardCore, type DayChip, type PlotDayCard, type WaterState } from './plotDayModel';
import { rupees } from './reflectDates';
import type { PlotRef } from './reflectSelection';
import { CropBanner, Num, Tap } from './ui';
import { inkOnColour } from '../../context/components/cropColourInk';
import { useLogAttachmentCount } from './useLogAttachmentCount';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { PlotCount } from '../../context/components/CropPlotPicker';
import { PlotGroupHeader, cropWordsOf } from '../../context/components/PlotSelector';
import {
    MANY_PLOTS_CARDS_SHOWN, foldsManyPlots, moreShownText, plotNumbers, plotShortName, smallPlotCardsFor, sortedNaturally,
} from '../../context/components/plotSelectorRules';

const WATER_TONE: Record<WaterState, string> = { ON_TRACK: 'bg-green-100 text-green-800', MISSED: 'bg-orange-100 text-orange-800', EXTRA: 'bg-blue-100 text-blue-800' };
/** The result screen's खर्च colour, for the ledger's money chip. */
const MONEY_TINT = partMeta('expense').tint;

/**
 * A counter or an amount on the card. English keeps the page's number font (Latin digits); Marathi mode writes the digits in Devanagari
 * (lane IT-D2, founder D-123b) in the card's own font, which has them - the number font does not.
 */
const Digits: React.FC<{ children: string | number; language: string | undefined }> = ({ children, language }) => (
    language === 'en' ? <Num>{children}</Num> : <span>{digitsFor(children, language)}</span>
);

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
            <Digits language={language}>{rupees(money.amount as number)}</Digits>
            <span className="text-[11.5px] font-bold text-stone-700" data-testid={`plot-money-source-${testKey}`}>{copy.fromLedger}</span>
            {money.partial.length > 0 && <span className="text-[11px] text-amber-800" data-testid={`plot-money-partial-${testKey}`}>· {copy.partialTag}</span>}
        </>
    );
    const label = money ? `${partNameIn('expense', language)} ${digitsFor(rupees(money.amount as number), language)} ${copy.fromLedger}` : '';
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

/** Words of the small card and its header tags. PROPOSED (Marathi); every one is a plain statement of a fact the card holds. */
const SMALL_WORDS = {
    mr: { problem: 'अडचण सांगितली', told: 'सांगितले', problemTag: 'अडचण', left: 'बाकी', open: 'प्लॉट उघडा', close: 'प्लॉट बंद करा' },
    en: { problem: 'A problem was reported', told: 'told', problemTag: 'problem', left: 'left', open: 'Open the plots', close: 'Close the plots' },
} as const;

/** One status for a plot's day, said in words: a stoppage told, how many times it was told, or nothing yet. */
type SmallStatus = 'problem' | 'told' | 'left';
const smallStatusOf = (card: PlotDayCard): SmallStatus => (card.status === 'blocked' ? 'problem' : card.recordings > 0 ? 'told' : 'left');

/**
 * The small plot card (crop of 4 or more plots): no photo of its own (the crop's header carries it), the crop's colour edge, the plot's name
 * without the crop word and its place number, one status, and the small mic only when the full card would offer "अजून सांगा" with a way to
 * speak. The whole card opens the plot's day; the mic stops that tap.
 */
const SmallPlotCard: React.FC<{ card: PlotDayCard; number?: number; isToday: boolean; onOpen: (ref: PlotRef) => void; onTell?: (ref: PlotRef) => void }> = ({ card, number, isToday, onOpen, onTell }) => {
    const { ref } = card;
    const language = useOptionalLanguage()?.language;
    const copy = useReflectCopy();
    const w = SMALL_WORDS[language === 'en' ? 'en' : 'mr'];
    const status = smallStatusOf(card);
    const mic = Boolean(card.nextHint && onTell);
    const name = plotShortName(ref.plotName ?? '', cropWordsOf(ref.crop));
    const tone = status === 'problem' ? 'bg-amber-100 text-amber-900' : status === 'told' ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700';
    return (
        <CardButton testId={`plot-card-${ref.key}`} status={card.status} onOpen={() => onOpen(ref)} edge={ref.cropColor} small>
            <span className={`block min-h-[64px] ${mic ? 'pb-11' : ''}`} data-part="small-card">
                <span className="flex items-baseline gap-1.5">
                    <span className="min-w-0 truncate text-[18px] font-extrabold leading-tight text-stone-900" data-part="name">{name}</span>
                    {number !== undefined && <span className="shrink-0 text-[14px] font-bold text-stone-700" data-part="number">{digitsFor(number, language)}</span>}
                </span>
                <span className={`mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-extrabold leading-snug ${tone}`} data-testid={`plot-status-${ref.key}`} data-status={status}>
                    {status === 'told' && <Check size={13} strokeWidth={3} className="shrink-0" aria-hidden="true" />}
                    <span className="min-w-0">{status === 'problem' ? w.problem : status === 'told' ? copy.timesTold(card.recordings, isToday) : copy.nothingTold(isToday)}</span>
                </span>
            </span>
            {mic && (
                <Tap onClick={e => { e.stopPropagation(); onTell?.(ref); }} data-testid={`plot-hint-speak-${ref.key}`} aria-label={`${copy.moreToTell} ${card.nextHint}`}
                    className="absolute bottom-2 right-2 grid h-11 w-11 place-items-center rounded-full bg-emerald-700 text-white">
                    <Mic size={20} aria-hidden="true" />
                </Tap>
            )}
        </CardButton>
    );
};

/**
 * A crop's header on the overview: its photo once, its plot count, and what the day looks like across its plots (true counts only; none drawn at 0).
 *
 * Lane UI-9a (founder D-173 = A, 2026-11-22), only when the page holds MORE THAN 15 plots (`folding`): the header gets a 44 px arrow and the crop
 * folds (its counts stay, so the whole farm reads in a few lines). A crop that holds a problem opens by itself, and so does a crop that is alone
 * on the page; his own tap on the arrow wins after that. Inside an open crop the cards come in the order of need - अडचण, then बाकी, then सांगितले,
 * each in number order - the first 6 are drawn (every problem card always, never hidden) and "आणखी N दाखवा" draws the rest. The tags follow the day
 * card's rule: "सांगितले" is every plot with a record (the stopped plots too), "अडचण" is drawn first as a flag with a warning-triangle shape.
 * With 15 plots or fewer none of this applies and the group is drawn exactly as before.
 */
const CropGroup: React.FC<{ cards: readonly PlotDayCard[]; isToday: boolean; onOpen: (ref: PlotRef) => void; onTell?: (ref: PlotRef) => void; folding?: boolean; alone?: boolean }> = ({ cards, isToday, onOpen, onTell, folding = false, alone = false }) => {
    const language = useOptionalLanguage()?.language;
    const lang = language === 'en' ? 'en' : 'mr';
    const w = SMALL_WORDS[lang];
    const first = cards[0].ref;
    // A card's number is its plot's place among ALL the crop's plots in natural order (G3 reads 3), not among the cards in view.
    const numbers = plotNumbers(first.crop.plots ?? []);
    const counts = { problem: 0, told: 0, left: 0 };
    for (const c of cards) counts[smallStatusOf(c)] += 1;
    // His own tap on the arrow wins; until then a crop with a problem, or alone on the page, is open.
    const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
    const [showAll, setShowAll] = useState(false);
    const open = !folding || (chosenOpen ?? (alone || counts.problem > 0));
    // The order of need (a stable partition: natural number order is kept inside each kind) and the cap; a problem card is never capped away.
    const ofKind = (kind: SmallStatus) => cards.filter(c => smallStatusOf(c) === kind);
    const byNeed = folding ? [...ofKind('problem'), ...ofKind('left'), ...ofKind('told')] : cards;
    const limit = Math.max(MANY_PLOTS_CARDS_SHOWN, counts.problem);
    const drawn = folding && !showAll ? byNeed.slice(0, limit) : byNeed;
    const rest = byNeed.length - drawn.length;
    const tag = (n: number, text: string, tone: string, id: string, flag = false) => (n > 0
        ? <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-extrabold ${tone}`} data-testid={`plot-group-${id}-${first.cropId}`}>
            {flag && <AlertTriangle size={13} strokeWidth={2.5} className="shrink-0" aria-hidden="true" data-part="flag" />}{digitsFor(n, language)} {text}
        </span>
        : null);
    const arrow = folding ? (
        <button type="button" onClick={() => setChosenOpen(!open)} aria-expanded={open} aria-label={open ? w.close : w.open} data-testid={`plot-group-fold-${first.cropId}`}
            className="grid h-11 w-11 shrink-0 place-items-center self-center rounded-xl border-2 border-stone-300 bg-white text-stone-800 active:scale-95">
            {open ? <ChevronUp size={22} aria-hidden="true" /> : <ChevronDown size={22} aria-hidden="true" />}
        </button>
    ) : undefined;
    return (
        <section className="space-y-2" data-testid={`plot-group-${first.cropId}`} data-small="yes">
            <PlotGroupHeader crop={first.crop} testId={`plot-group-header-${first.cropId}`} language={lang}
                sub={<PlotCount total={cards.length} language={lang} />} right={arrow} />
            <div className="flex flex-wrap gap-1.5 empty:hidden">
                {folding ? (
                    <>
                        {tag(counts.problem, w.problemTag, 'bg-amber-100 text-amber-900', 'problem', true)}
                        {tag(counts.left, w.left, 'bg-stone-100 text-stone-700', 'left')}
                        {tag(counts.told + counts.problem, w.told, 'bg-emerald-100 text-emerald-900', 'told')}
                    </>
                ) : (
                    <>
                        {tag(counts.told, w.told, 'bg-emerald-100 text-emerald-900', 'told')}
                        {tag(counts.problem, w.problemTag, 'bg-amber-100 text-amber-900', 'problem')}
                        {tag(counts.left, w.left, 'bg-stone-100 text-stone-700', 'left')}
                    </>
                )}
            </div>
            {open && (
                <>
                    <div className="grid grid-cols-2 gap-2" data-testid={`plot-small-cards-${first.cropId}`}>
                        {drawn.map(c => <SmallPlotCard key={c.ref.key} card={c} number={c.ref.plotId ? numbers.get(c.ref.plotId) : undefined} isToday={isToday} onOpen={onOpen} onTell={onTell} />)}
                    </div>
                    {rest > 0 && (
                        <button type="button" onClick={() => setShowAll(true)} data-testid={`plot-more-${first.cropId}`}
                            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border-2 border-emerald-800 bg-white px-3 text-[14.5px] font-extrabold text-emerald-800 active:scale-[0.98]">
                            {moreShownText(rest, language)}
                        </button>
                    )}
                </>
            )}
        </section>
    );
};

/** A whole card is the button into its day (Enter / Space too). */
const CardButton: React.FC<{ testId: string; status: DayCardCore['status']; onOpen: () => void; children: React.ReactNode; edge?: string; small?: boolean }> = ({ testId, status, onOpen, children, edge, small }) => {
    const tint = status === 'blocked' ? 'border-amber-200 bg-amber-50' : status === 'worked' ? 'border-emerald-200 bg-white' : 'border-stone-200 bg-white';
    return (
        <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
            data-testid={testId} data-status={status}
            className={`relative block w-full cursor-pointer border-2 text-left transition-transform active:scale-[0.99] ${small ? 'min-w-0 rounded-2xl p-2 pl-3.5' : 'rounded-[18px] p-3 pl-4'} ${tint}`}>
            {edge && <span className={`absolute inset-y-0 left-0 w-1.5 ${small ? 'rounded-l-2xl' : 'rounded-l-[18px]'} ${edge}`} aria-hidden="true" data-part="edge" />}
            {children}
        </div>
    );
};

/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2; founder 2026-11-06; preview DFES-meter-and-names) - who told
 * the plot's day, each by his real name (the phone holder's own name too, never "तुम्ही"), and the server's ONE "tell more" line
 * with the mic. WORDS ONLY: no meter, no bar, no number. The line is drawn only when there is something to say AND the mic can
 * be opened for it (`onTell`: today, with a speak door) - never a hint that leads nowhere (P5).
 */
const WhoAndHint: React.FC<{ card: PlotDayCard; testKey: string; onTell?: () => void }> = ({ card, testKey, onTell }) => {
    const copy = useReflectCopy();
    return (
        <>
            {card.speakers.length > 0 && (
                <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-stone-600" data-testid={`plot-who-${testKey}`}>
                    {copy.toldBy}
                    {card.speakers.map(name => (
                        <span key={name} data-testid={`plot-who-name-${testKey}`}
                            className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[12px] font-extrabold text-blue-900">
                            <User size={12} aria-hidden="true" />{name}
                        </span>
                    ))}
                </span>
            )}
            {card.nextHint && onTell && (
                <span className="mt-2.5 flex items-center justify-between gap-2 rounded-2xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200" data-testid={`plot-hint-${testKey}`}>
                    <span className="text-[14.5px] font-bold leading-snug text-stone-800"><span className="font-extrabold text-amber-800">{copy.moreToTell}</span> {card.nextHint}</span>
                    <Tap onClick={e => { e.stopPropagation(); onTell(); }} data-testid={`plot-hint-speak-${testKey}`} aria-label={`${copy.moreToTell} ${card.nextHint}`}
                        className="inline-flex min-h-[42px] shrink-0 items-center gap-1 rounded-full bg-emerald-700 px-3 text-[14px] font-extrabold text-white">
                        <Mic size={16} aria-hidden="true" />{copy.speak}
                    </Tap>
                </span>
            )}
        </>
    );
};

const PlotDayCardView: React.FC<{ card: PlotDayCard; isToday: boolean; onOpen: (ref: PlotRef) => void; onCost?: (ref: PlotRef) => void; onTell?: (ref: PlotRef) => void }> = ({ card, isToday, onOpen, onCost, onTell }) => {
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
            <span className="flex flex-col gap-2">
                <CropBanner iconName={ref.crop.iconName} name={ref.cropName} />
                {/* Founder 2026-11-20 (option Q): the crop's own colour carries the plot's name, so the photo stays clean. */}
                <span data-part="title-bar" className={`block rounded-xl px-3 py-2 ${ref.cropColor || 'bg-stone-300'} ${inkOnColour(ref.cropColor)}`}>
                    <span className="block text-[18px] font-extrabold leading-tight">{ref.plotName ?? (cropName || ref.cropName)}</span>
                    <span className="block text-[13px] font-bold opacity-90">{[cropName, realVariety, card.area, card.dayLabel].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex items-center justify-end gap-2 empty:hidden">
                    {card.confirmed !== undefined && <StatusChip confirmed={card.confirmed} testId={`plot-state-${ref.key}`} />}
                    {files > 0 && <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[12px] font-bold text-blue-700 ring-1 ring-blue-100" aria-label={`जोडलेल्या फाइल ${digitsFor(files, language)}`} data-testid={`plot-files-${ref.key}`}><Paperclip size={12} aria-hidden="true" /><Digits language={language}>{files}</Digits></span>}
                </span>
            </span>
            <Chips card={card} testKey={ref.key} onCost={onCost ? () => onCost(ref) : undefined} />
            <WhoAndHint card={card} testKey={ref.key} onTell={onTell ? () => onTell(ref) : undefined} />
            {(card.water || card.weather) && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                    {card.water && <span className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-extrabold ${WATER_TONE[card.water]}`}><Droplets size={13} aria-hidden="true" />{WATER_LABEL[card.water]}</span>}
                    {card.weather && <span className="flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[12.5px] font-bold text-sky-800 ring-1 ring-sky-100"><Thermometer size={13} aria-hidden="true" /><Digits language={language}>{card.weather.temp}</Digits> · {card.weather.condition}</span>}
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
    /** The "tell more" line's mic: THE ONE mic for that plot. Omit and the line is not drawn (never a mic that leads nowhere). */
    onTell?: (ref: PlotRef) => void;
}> = ({ cards, farm, isToday, onOpen, onOpenFarm, onCost, onTell }) => {
    // The cards of one crop sit together (the farm's own order). A crop with 4 or more cards is a header and small cards; fewer keep the full card.
    const groups: PlotDayCard[][] = [];
    for (const c of cards) {
        const last = groups[groups.length - 1];
        if (last && last[0].ref.cropId === c.ref.cropId && c.ref.plotId) last.push(c); else groups.push([c]);
    }
    // Natural number order inside a crop (G2 before G10); a crop with no plot yet has its one card.
    const ordered = groups.map(g => (g[0].ref.plotId ? sortedNaturally(g, c => c.ref.plotName ?? '') : g));
    // Lane UI-9a (founder D-173 = A): more than 15 plots ON THE PAGE (what is shown, not what the farm holds) folds the crops.
    const folding = foldsManyPlots(cards.filter(c => c.ref.plotId).length);
    const alone = ordered.filter(g => g[0].ref.plotId).length === 1;
    return (
        <div className="space-y-2.5" data-testid="plot-day-cards">
            {ordered.map(g => (smallPlotCardsFor(g.length) && g[0].ref.plotId
                ? <CropGroup key={`group:${g[0].ref.cropId}`} cards={g} isToday={isToday} onOpen={onOpen} onTell={onTell} folding={folding} alone={alone} />
                : g.map(c => <PlotDayCardView key={c.ref.key} card={c} isToday={isToday} onOpen={onOpen} onCost={onCost} onTell={onTell} />)))}
            {farm && onOpenFarm && <FarmDayCardView card={farm} isToday={isToday} onOpen={onOpenFarm} />}
        </div>
    );
};
