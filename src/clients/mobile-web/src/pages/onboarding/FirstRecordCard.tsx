/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FirstRecordCard — repair R1-g Part 1, task 1a (founder Q5 = Option A, 28 Nov; CTO rulings 1-2).
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22.
 *
 * After "चला, सुरुवात करूया" a new farm owner goes straight into his own REAL farm, to ONE card that asks for his first
 * genuine record: "आज शेतात काय काय केलं?" / "जसं आठवतंय, तसं सांगा. बाकी आम्ही करू." / "बोलायला सुरुवात करा" /
 * "नंतर सांगेन" (his words, `firstRecordWords.ts`). No sample farm, no practice note, no forced setup.
 *
 * Presentational: the router decides who sees it (an owner or co-owner seat, once, on the first run only) and what each
 * button does ("बोलायला सुरुवात करा" opens the farm's own voice entry, "नंतर सांगेन" goes Home). It wears the first run's
 * own look (`FirstRunShell`: the dawn backdrop, the serif heading, the green pill) and its one "← मागे" (FR-8) back to the
 * role welcome.
 */
import React from 'react';
import { Mic } from 'lucide-react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { Tap } from '../../shared/components/ui/placeUi';
import { FirstRunGlass, FirstRunHeading, FirstRunShell, GreenButton, Rise } from '../../features/onboarding/firstRun/FirstRunShell';
import { firstRunCopy } from '../../features/onboarding/firstRun/firstRunCopy';
import { firstRecordWords } from '../../features/onboarding/firstRun/firstRecordWords';

export interface FirstRecordCardProps {
    /** "बोलायला सुरुवात करा": the farm's own voice entry. */
    onStart: () => void;
    /** "नंतर सांगेन": Home. */
    onLater: () => void;
    /** Back to the role welcome. */
    onBack?: () => void;
}

const FirstRecordCard: React.FC<FirstRecordCardProps> = ({ onStart, onLater, onBack }) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const words = firstRecordWords(language).card;
    return (
        <FirstRunShell testId="first-record-card" onBack={onBack} backLabel={firstRunCopy(language).back}>
            <div className="flex flex-1 flex-col justify-center py-4">
                <Rise d={0.1}>
                    <FirstRunGlass className="flex flex-col items-center gap-3 px-5 py-6 text-center" testId="first-record-card-body">
                        <span aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-500/30">
                            <Mic size={30} strokeWidth={2.4} />
                        </span>
                        <FirstRunHeading testId="first-record-title">{words.title}</FirstRunHeading>
                        <p className="m-0 text-[17px] font-bold leading-snug text-stone-700 [overflow-wrap:anywhere]" data-testid="first-record-line">
                            {words.line}
                        </p>
                    </FirstRunGlass>
                </Rise>
            </div>
            <Rise d={0.3} className="flex flex-col gap-3">
                <GreenButton onClick={onStart} testId="first-record-start">{words.start}</GreenButton>
                <Tap onClick={onLater} data-testid="first-record-later"
                    className="min-h-[52px] w-full rounded-full border border-stone-300 bg-white/90 px-4 text-[16px] font-extrabold text-stone-700 shadow-sm">
                    {words.later}
                </Tap>
            </Rise>
        </FirstRunShell>
    );
};

export default FirstRecordCard;
