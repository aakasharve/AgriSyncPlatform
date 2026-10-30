/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b) — Sathi's ONE question in the founder's designed look
 * (design `SathiQuestion.tsx`): an amber card, the heading "तुम्ही अजून उलगडून सांगितलं तर साथी नीट समजून घेऊ शकेल"
 * (founder 2026-10-24: he understands MORE — never "Sathi wants more", never "the number will rise"), the question,
 * and the answers the REAL question engine can take:
 *   - a question with choices: one chip per choice (recorded as today), and "नंतर";
 *   - an open question: MIC FIRST ("बोलून सांगा" takes him to the same microphone with the question pinned, writing
 *     nothing until he speaks — wave-3.7), and "नंतर" (recorded as put off, the engine's own skip).
 * The design's "अंदाजे" / "आठवत नाही" chips are NOT here: an answer to Sathi's question is stored as plain text
 * (`question_events.response`, turned into a spoken observation on the log) with no certainty beside it, so those
 * chips would store a claim the record cannot hold truthfully (P5, P8). Presentational: the host owns the writes.
 */
import React from 'react';
import { Mic } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { DfesAnswerOption } from '../../services/dfesQuestionBank';
import { resultCopy } from './resultCopy';

const SANS = "'Noto Sans Devanagari', sans-serif";

const Chip: React.FC<{ testId: string; label: string; onClick: () => void }> = ({ testId, label, onClick }) => (
    <button type="button" onClick={onClick} data-testid={testId}
        className="min-h-[48px] rounded-2xl border border-stone-300 bg-white px-4 text-[15px] font-extrabold text-stone-700 active:scale-95">{label}</button>
);

export interface SathiQuestionCardProps {
    /** The engine's resolved question (Marathi: the question bank has no other language yet). */
    prompt: string;
    /** Tap choices; absent = an open question, answered by speaking. */
    options?: readonly DfesAnswerOption[];
    onAnswer: (option: DfesAnswerOption) => void;
    /** "नंतर": the engine's own skip. */
    onLater: () => void;
    /** Opens the microphone with the question pinned (open questions). */
    onSpeak: () => void;
}

export const SathiQuestionCard: React.FC<SathiQuestionCardProps> = ({ prompt, options, onAnswer, onLater, onSpeak }) => {
    const copy = resultCopy(useOptionalLanguage()?.language);
    const choices = options ?? [];
    return (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5" style={{ fontFamily: SANS }} data-testid="vr-question" data-kind={choices.length > 0 ? 'choice' : 'speak'}>
            <p className="m-0 mb-1.5 text-[14px] font-extrabold leading-snug text-amber-900" data-testid="vr-ask-heading">{copy.askHeading}</p>
            <h4 className="mb-3 text-[17px] font-extrabold leading-snug text-amber-950" data-testid="vr-question-prompt">{prompt}</h4>
            {choices.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {choices.map(o => <Chip key={o.value} testId="vr-answer-option" label={o.labelMr} onClick={() => onAnswer(o)} />)}
                    <Chip testId="vr-later" label={copy.later} onClick={onLater} />
                </div>
            ) : (
                <>
                    <button type="button" onClick={onSpeak} data-testid="vr-answer-speak"
                        className="mb-2 flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-lg font-extrabold text-white active:scale-[0.98]">
                        <Mic size={22} aria-hidden="true" /> {copy.speakAnswer}
                    </button>
                    <div className="flex flex-wrap gap-2">
                        <Chip testId="vr-later" label={copy.later} onClick={onLater} />
                    </div>
                </>
            )}
        </div>
    );
};

export default SathiQuestionCard;
