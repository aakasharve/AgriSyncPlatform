/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; D-139 fifth note) - the 3-card "how to read this": the green tick, the
 * grey number, work in no schedule. Shown once automatically (the caller keeps the "seen" flag), skippable, and the "?" brings it back.
 */
import React, { useState } from 'react';
import { useBackDismiss } from '../../core/navigation/useBackDismiss';
import { PHONE_COLUMN } from '../logs/components/phoneColumn';
import { Dots, GreyNumber, PartIcon, SANS_FONT, TickMark } from './compareBits';
import { n, type CompareLang, type CompareWords } from './compareWords';

export const CompareCoach: React.FC<{ words: CompareWords; lang: CompareLang; onFinish: () => void }> = ({ words, lang, onFinish }) => {
    const [step, setStep] = useState(0);
    useBackDismiss(true, onFinish);
    const last = step === words.coach.cards.length - 1;
    const picture = step === 0
        ? <TickMark size={72} label={words.sameAsScheduleAll} />
        : step === 1
            ? <GreyNumber text={n(lang, 2)} label={words.noRecordYet} />
            : <span className="inline-flex items-center gap-2.5 rounded-2xl border-2 border-dashed border-stone-400 bg-white px-3 py-2"><PartIcon part="own" size={24} /><i className="inline-block h-[3px] w-5 rounded bg-stone-300" aria-hidden="true" /><Dots tone="done" count={1} /></span>;
    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-900/50 px-4" data-testid="compare-coach-veil">
            <div role="dialog" aria-modal="true" aria-label={words.coach.title} data-testid="compare-coach" className={`rounded-3xl bg-white p-5 shadow-2xl ${PHONE_COLUMN}`} style={{ fontFamily: SANS_FONT }}>
                <div className="flex min-h-[80px] items-center justify-center" data-testid="compare-coach-picture">{picture}</div>
                <p className="m-0 mt-3 text-center text-[17px] font-extrabold leading-snug text-stone-900" data-testid="compare-coach-text">{words.coach.cards[step]}</p>
                <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
                    {words.coach.cards.map((_, i) => <i key={i} className={`inline-block h-2.5 w-2.5 rounded-full ${i === step ? 'bg-emerald-700' : 'bg-stone-300'}`} />)}
                </div>
                <button type="button" onClick={() => (last ? onFinish() : setStep(step + 1))} data-testid="compare-coach-next"
                    className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-emerald-700 text-[17px] font-extrabold text-white">
                    {last ? words.coach.done : words.coach.next}
                </button>
                {!last && (
                    <button type="button" onClick={onFinish} data-testid="compare-coach-skip"
                        className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-stone-300 bg-white text-[16px] font-extrabold text-stone-800">
                        {words.coach.skip}
                    </button>
                )}
            </div>
        </div>
    );
};

export default CompareCoach;
