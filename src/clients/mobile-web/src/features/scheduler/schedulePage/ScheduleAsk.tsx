/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 3; D-83 = 1, D-76, D-91 = 1, open point 9 (a)(b), P5, P10)
 *
 * "आधी शेड्यूल निवडा" - the ask that stands in front of NEW planning and the शेड्यूल page (never a record door: the log page, the
 * mic, हजेरी, खरेदी, मंजूर, a handed-out task and "काम झालं" always open - D-83). It is drawn for ONE plot the server says needs a schedule
 * (`useScheduleGate().needsSchedule`), and offers:
 *   - the crop's CHECKED schedule (the Institution one first) - or, on a crop with no checked one, the sample, said to be a sample;
 *     the choice goes through the existing adopt (`saveScheduleChoice`, this plot only - the same door "हे शेड्यूल पण पाळा" uses),
 *     not a new write. With nothing the phone could offer it draws nothing at all (ask nothing where nothing can be chosen: P5);
 *   - "स्वतःचं शेड्यूल बनवा" (lane SCH-OWN-b, Q1 = 1): LIVE, and only for a seat that may make (the owner or ScheduleTemplates) - it takes him to planning, where
 *     the maker opens, and writes nothing. Any other seat, or one the phone does not know, is not shown it at all (nothing greyed, no promise line: P10).
 * Words: `scheduleGateCopy` (Marathi mode Marathi only, English mode English only). Targets are 64px high.
 */
import React, { useState } from 'react';
import { Pencil, ShieldCheck, Sprout } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { defaultScheduleForCrop } from '../planning/followableDefault';
import { SCHEDULE_GATE_WORDS, type GateLanguage } from './scheduleGateCopy';
import { scheduleNameMr } from './scheduleNames';
import { saveScheduleChoice, type SaveScheduleChoiceResult } from './saveScheduleChoice';

export interface ScheduleAskProps {
    /** The crop's name as the phone holds it (the crop rule reads Marathi and English names alike). */
    cropName: string;
    plotId: string;
    /** Shown above the words when several plots may be asked about at once (planning). */
    plotLabel?: string;
    where: 'planning' | 'page';
    /** After the choice was handed to the adopt path (queued for the server, or kept on this phone). */
    onSaved?: (result: SaveScheduleChoiceResult, plotId: string) => void;
    /** Absent = the app's chosen language (the language context). The planning page passes the language it was given. */
    language?: string | null;
    /** spec: plr-d10 lane SCH-OWN-b - this seat may make an own schedule. Absent = no (fail closed). */
    mayMakeOwn?: boolean;
    /** Goes to planning where the maker opens (in planning itself: opens it there). */
    onMakeOwn?: () => void;
}

export const ScheduleAsk: React.FC<ScheduleAskProps> = ({ cropName, plotId, plotLabel, where, onSaved, language: languageProp, mayMakeOwn = false, onMakeOwn }) => {
    const contextLanguage = useOptionalLanguage()?.language;
    const language: GateLanguage = (languageProp ?? contextLanguage) === 'en' ? 'en' : 'mr';
    const words = SCHEDULE_GATE_WORDS[language];
    const [busy, setBusy] = useState(false);
    const offer = defaultScheduleForCrop(cropName);
    if (!offer) return null;

    const name = language === 'mr' ? scheduleNameMr(offer.template.name) : offer.template.name;
    const choose = () => {
        if (busy) return;
        setBusy(true);
        // The same door as "हे शेड्यूल पण पाळा": an adopt for THIS plot only. The phone writes the choice at once, so the ask is gone.
        void saveScheduleChoice([{ plotId, templateId: offer.template.id, add: true }]).then(
            result => { setBusy(false); onSaved?.(result, plotId); },
            () => setBusy(false),
        );
    };

    return (
        <section className="space-y-3 rounded-3xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm" data-testid="schedule-ask" data-where={where} data-kind={offer.kind} data-plot={plotId} data-language={language}>
            <h2 className="m-0 text-[20px] font-black leading-snug text-amber-950" data-testid="schedule-ask-title">{words.askTitle}</h2>
            {plotLabel && <p className="m-0 text-[15px] font-extrabold text-stone-800" data-testid="schedule-ask-plot">{plotLabel}</p>}
            <p className="m-0 text-[15px] font-bold leading-snug text-stone-800" data-testid="schedule-ask-why">{where === 'planning' ? words.askWhyPlanning : words.askWhyPage}</p>
            <Tap onClick={choose} disabled={busy} data-testid="schedule-ask-choose"
                className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-emerald-500 bg-white px-3 py-2 text-left disabled:opacity-60">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                    {offer.kind === 'checked' ? <ShieldCheck size={20} aria-hidden="true" /> : <Sprout size={20} aria-hidden="true" />}
                </span>
                <span className="min-w-0">
                    <strong className="block text-[17px] font-black leading-snug text-stone-900">{offer.kind === 'checked' ? words.chooseChecked : words.chooseSample}</strong>
                    <span className="block text-[15px] font-bold leading-snug text-stone-700" data-testid="schedule-ask-offer-name">{name}</span>
                </span>
            </Tap>
            {mayMakeOwn && onMakeOwn && (
                <Tap onClick={onMakeOwn} data-testid="schedule-ask-own"
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-amber-500 bg-white px-3 py-2 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-700 text-white"><Pencil size={18} aria-hidden="true" /></span>
                    <span className="min-w-0">
                        <strong className="block text-[17px] font-black leading-snug text-stone-900">{words.ownTitle}</strong>
                    </span>
                </Tap>
            )}
        </section>
    );
};

export default ScheduleAsk;
