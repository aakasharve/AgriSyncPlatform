/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-3; founder D-74 "3 + 1", D-76 / R6, D-82 = 3, D-88 = 2, D-91 = 1)
 *
 * "तुम्ही पाळत असलेली शेड्यूल" - the schedules one plot follows, drawn as the founder's working screen draws them
 * (`3plus1-working-screen.html`, `scheduleSection()`): the 3 + 1 rail, three outside places, one place of his own.
 *   - a filled outside place: the schedule's name, its source, ShramSafal's check (the badge, or "not yet checked" for a sample), "मुख्य"
 *     on the one the SERVER named (R6; never worked out here), and "हे सोडा";
 *   - a free outside place: ONE "हे शेड्यूल पण पाळा" with the line that says what may be chosen (checked ones; or the sample while the crop
 *     has no checked schedule: the phone decides this from the library it holds, D-91 = 1); full: the sentence that says why not;
 *   - his own place: empty = DISABLED (no tap target) with its words - the maker opens in SCH-OWN (P5, never a button that does nothing);
 *     filled = the name, "बनवलं: ‹नाव›" only when the schedule carries a real maker name (D-88 = 2), the no-check line, never a badge,
 *     never "तपासणी बाकी" (D-82 = 3);
 *   - the stage-line note when two or more are followed.
 * The phone never counts places or limits: the server refuses a 4th (ScheduleLimitReached). The count here only DRAWS what is held.
 * Words: Marathi mode Marathi only, English mode English only (`threePlusOneCopy`).
 */
import React, { useState } from 'react';
import { BadgeCheck, CircleDashed, Flag, HelpCircle, Lock, Pencil, Plus, X } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { FollowedPlace } from './resolveSchedule';
import { scheduleNameMr } from './scheduleNames';
import { checkWords, THREE_PLUS_ONE_WORDS, type ThreePlusOneLanguage } from './threePlusOneCopy';

/** The saved author is shown only when it is a real name, not the catalog's internal English tag. */
const INTERNAL_AUTHORS = new Set(['ShramSafal Reference Data', 'System Fallback']);

/** The place colours of the working screen's rail (outside 1, 2, 3 and his own). */
export const PLACE_COLOUR = ['#0f766e', '#7c3aed', '#c2410c'] as const;
export const OWN_COLOUR = '#b45309';

export interface ThreePlusOneSectionProps {
    /** Every schedule the plot follows, in place order (`resolvePlotSchedule(...).followed`). */
    followed: readonly FollowedPlace[];
    /** The crop has a Checked schedule in the library this phone holds: the free place says only checked ones can be chosen (D-82 note). */
    cropHasChecked: boolean;
    /** Opens the library to follow one more on THIS plot. */
    onAdd: () => void;
    /** "हे सोडा": lets that subscription go. */
    onLeave: (subscriptionId: string) => void;
}

const displayName = (place: FollowedPlace, language: ThreePlusOneLanguage): string => {
    if (!place.template) return THREE_PLUS_ONE_WORDS[language].schedule;
    return language === 'mr' ? scheduleNameMr(place.template.name) : place.template.name;
};

const makerOf = (place: FollowedPlace): string | null => {
    const author = place.template?.createdBy?.trim();
    return author && !INTERNAL_AUTHORS.has(author) ? author : null;
};

const Rail: React.FC<{ outside: readonly FollowedPlace[]; own: FollowedPlace | undefined; label: string }> = ({ outside, own, label }) => (
    <span className="inline-flex items-center gap-1.5" aria-label={label} data-testid="three-plus-one-rail">
        {[0, 1, 2].map(i => (
            <b key={i} data-filled={outside[i] ? 'true' : 'false'} className="inline-block h-3.5 w-3.5 rounded-full"
                style={{ background: outside[i] ? PLACE_COLOUR[i] : '#e7e5e4' }} />
        ))}
        <em className="text-[14px] font-extrabold not-italic text-stone-500">+</em>
        <b data-filled={own ? 'true' : 'false'} className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: own ? OWN_COLOUR : '#e7e5e4' }} />
    </span>
);

const CheckBadge: React.FC<{ place: FollowedPlace; language: ThreePlusOneLanguage }> = ({ place, language }) => {
    const checked = place.checkState === 'Checked';
    return (
        <span data-testid={`followed-check-${place.subscriptionId}`} data-check-state={place.checkState}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-extrabold ${checked ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-stone-100 text-stone-600 ring-1 ring-stone-200'}`}>
            {checked ? <BadgeCheck size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}
            {checkWords(language, place.checkState)}
        </span>
    );
};

const PlaceCard: React.FC<{ place: FollowedPlace; colour: string; language: ThreePlusOneLanguage; onLeave: (id: string) => void }> = ({ place, colour, language, onLeave }) => {
    const words = THREE_PLUS_ONE_WORDS[language];
    const own = place.origin === 'Own';
    const maker = own ? makerOf(place) : null;
    return (
        <div className="flex overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm" data-testid={`followed-${place.subscriptionId}`}
            data-slot={place.slot ?? ''} data-origin={place.origin} data-main={place.isMain ? 'true' : 'false'}>
            <span className="w-2 shrink-0" style={{ background: colour }} aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                    <strong className="min-w-0 flex-1 text-[18px] font-black leading-snug text-stone-900" data-testid={`followed-name-${place.subscriptionId}`}>{displayName(place, language)}</strong>
                    {place.isMain && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[14px] font-extrabold text-amber-900" data-testid={`followed-main-${place.subscriptionId}`}>
                            <Flag size={14} aria-hidden="true" />{words.main}
                        </span>
                    )}
                </div>
                {place.template?.sourceLabel && !own && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid={`followed-source-${place.subscriptionId}`}>{place.template.sourceLabel}</p>}
                {maker && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid={`followed-maker-${place.subscriptionId}`}>{words.ownMadeBy(maker)}</p>}
                {place.pending && !place.refused && <p className="m-0 text-[13.5px] font-bold text-stone-500" data-testid={`followed-pending-${place.subscriptionId}`}>{words.waiting}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {own
                        ? <span className="text-[14px] font-bold text-stone-600" data-testid={`followed-own-note-${place.subscriptionId}`}>{words.ownNoCheck}</span>
                        : <CheckBadge place={place} language={language} />}
                    <Tap onClick={() => onLeave(place.subscriptionId)} data-testid={`followed-leave-${place.subscriptionId}`}
                        className="min-h-[48px] rounded-full px-3 text-[16px] font-extrabold text-rose-700 underline underline-offset-2">{words.leave}</Tap>
                </div>
            </div>
        </div>
    );
};

const HelpSheet: React.FC<{ language: ThreePlusOneLanguage; onClose: () => void }> = ({ language, onClose }) => {
    const words = THREE_PLUS_ONE_WORDS[language];
    const marks = ['3', '1', <BadgeCheck key="b" size={16} aria-hidden="true" />, <Pencil key="p" size={16} aria-hidden="true" />, <Flag key="f" size={16} aria-hidden="true" />];
    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={words.helpTitle} data-testid="three-plus-one-help">
            <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-4 pb-8 pt-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="m-0 text-[20px] font-black text-stone-900">{words.helpTitle}</h2>
                    <Tap onClick={onClose} aria-label={words.close} data-testid="three-plus-one-help-close" className="grid min-h-[48px] min-w-[48px] place-items-center rounded-full text-stone-700"><X size={22} aria-hidden="true" /></Tap>
                </div>
                <ul className="m-0 mt-3 space-y-3 p-0">
                    {words.help.map((line, i) => (
                        <li key={i} className="flex list-none items-start gap-3" data-testid={`three-plus-one-help-line-${i + 1}`}>
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-100 text-[16px] font-black text-stone-800">{marks[i]}</span>
                            <span className="text-[16px] font-bold leading-snug text-stone-800">{line}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export const ThreePlusOneSection: React.FC<ThreePlusOneSectionProps> = ({ followed, cropHasChecked, onAdd, onLeave }) => {
    const language: ThreePlusOneLanguage = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = THREE_PLUS_ONE_WORDS[language];
    const [help, setHelp] = useState(false);

    const outside = followed.filter(p => p.origin !== 'Own');
    const own = followed.find(p => p.origin === 'Own');
    const main = followed.find(p => p.isMain);
    // Only DRAWS what is held: three places on the screen. The server is the one that refuses a 4th.
    const outsideFull = outside.length >= 3;

    return (
        <section className="space-y-3 rounded-3xl border border-stone-200 bg-white/90 p-4 shadow-sm" data-testid="three-plus-one" data-language={language}>
            {followed.length >= 2 && main && (
                <p className="m-0 text-[14.5px] font-extrabold text-emerald-800" data-testid="stage-line-note">{words.stageLine(displayName(main, language))}</p>
            )}
            <h2 className="m-0 text-[19px] font-black text-stone-900" data-testid="three-plus-one-heading">{words.heading}</h2>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Tap onClick={() => setHelp(true)} data-testid="three-plus-one-help-open"
                    className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full bg-sky-50 px-4 text-[15px] font-extrabold text-sky-800 ring-1 ring-sky-200">
                    <HelpCircle size={17} aria-hidden="true" />{words.whatIs}
                </Tap>
                <Rail outside={outside} own={own} label={words.railLabel} />
            </div>

            <p className="m-0 text-[14px] font-extrabold uppercase tracking-wide text-stone-500" data-testid="three-plus-one-outside-label">{words.outsideGroup}</p>
            {outside.map((place, i) => (
                <PlaceCard key={place.subscriptionId || `${place.templateId}-${i}`} place={place} colour={PLACE_COLOUR[i] ?? PLACE_COLOUR[2]} language={language} onLeave={onLeave} />
            ))}
            {!outsideFull ? (
                <Tap onClick={onAdd} data-testid="three-plus-one-add"
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-50/60 px-3 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Plus size={20} aria-hidden="true" /></span>
                    <span className="min-w-0">
                        <strong className="block text-[17px] font-black text-stone-900" data-testid="three-plus-one-add-word">{followed.length === 0 ? words.firstChoice : words.follow}</strong>
                        <span className="block text-[14px] font-bold text-stone-600" data-testid="three-plus-one-add-why">{cropHasChecked ? words.followWhy : words.followWhySample}</span>
                    </span>
                </Tap>
            ) : (
                <div className="flex items-start gap-2 rounded-2xl bg-stone-100 px-3 py-3 text-[15px] font-bold text-stone-700" data-testid="three-plus-one-full">
                    <Lock size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{words.fullNote}
                </div>
            )}

            <p className="m-0 text-[14px] font-extrabold uppercase tracking-wide text-stone-500" data-testid="three-plus-one-own-label">{words.ownGroup}</p>
            {own ? (
                <PlaceCard place={own} colour={OWN_COLOUR} language={language} onLeave={onLeave} />
            ) : (
                // P5: the maker opens in SCH-OWN; until then this place is shown, with its words, and cannot be tapped.
                <div role="group" aria-disabled="true" className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 px-3 opacity-80" data-testid="three-plus-one-own-empty">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-300 text-white"><Pencil size={18} aria-hidden="true" /></span>
                    <span className="min-w-0">
                        <strong className="block text-[17px] font-black text-stone-700">{words.ownEmptyTitle}</strong>
                        <span className="block text-[14px] font-bold text-stone-600">{words.ownEmptyHint}</span>
                    </span>
                </div>
            )}
            {help && <HelpSheet language={language} onClose={() => setHelp(false)} />}
        </section>
    );
};

export default ThreePlusOneSection;
