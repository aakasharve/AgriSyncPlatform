/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F7) - what he sees when the answer holds no work (`dayOutcome` IRRELEVANT_INPUT, or no parts), as
 * the approved design draws it (shot 12): "आवाज जतन झाला", "काम सापडलं नाही - खालचा माइक दाबून सांगा", the meter at 0 / १०, the ask
 * "आज कोणतं काम केलं?" and the "कसं सांगायचं?" examples. It replaces the red "इनपुट तपासा" card of the old recorder. His own words are
 * shown as he said them (they may hold English words he spoke), and nowhere else. Nothing is invented: no part, no number but the
 * 0 of a day with no work, which is what the server's answer holds.
 */
import React from 'react';
import { Mic } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { CategoryIcon } from '../../../logs/components/shramsathi/understandingRing/CategoryIcon';
import type { IconName } from '../../../logs/components/shramsathi/understandingRing/icons';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";
const ICONS: readonly IconName[] = ['work', 'labour', 'inputs'];

export const NothingUnderstood: React.FC<{ transcript?: string }> = ({ transcript }) => {
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    return (
        <div className="mt-3 flex w-full flex-col gap-2.5" style={{ fontFamily: SANS }} data-testid="nothing-understood">
            <div className="rounded-2xl border-[1.5px] border-[#B7E4C7] bg-[#E9F8EE] px-3.5 py-2.5">
                <b className="block text-[20px] leading-[1.25] text-[#0F6B3A]" style={{ fontFamily: SERIF }} data-testid="nu-title">{W.nuTitle}</b>
                <span className="mt-0.5 block text-[14px] font-bold leading-snug text-[#1C1917]" data-testid="nu-sub">{W.nuSub}</span>
            </div>
            {transcript && (
                <p className="m-0 rounded-2xl border border-[#DDE3DA] bg-white px-3.5 py-2 text-[15px] leading-snug text-[#1C1917]" data-testid="nu-heard">
                    <span className="block text-[12px] font-extrabold text-[#5F6B63]">{W.nuHeard}</span>
                    {transcript}
                </p>
            )}
            <div className="flex items-center justify-between rounded-2xl border border-[#F0DFA6] bg-[#FFFBEA] px-3.5 py-2" data-testid="nu-meter">
                <span className="text-[13px] font-extrabold text-[#8A6400]">{W.nuMeterTitle}</span>
                <span className="text-[20px] font-bold text-[#1E56E6]" style={{ fontFamily: SERIF }}>{digitsFor('0', language)}<span className="text-[12px]"> / {digitsFor('10', language)}</span></span>
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl border-2 border-[#F3D27A] bg-[#FFFDF3] px-3 py-2" data-testid="nu-ask">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white" style={{ background: 'radial-gradient(circle at 35% 30%,#3ccf78,#0F6B3A)' }}><Mic size={20} aria-hidden="true" /></span>
                <span className="text-[15px] font-extrabold text-[#1C1917]">{W.nuAsk}</span>
            </div>
            <div className="rounded-[18px] border border-dashed border-[#7EC09A] bg-white px-3 py-2" data-testid="nu-how">
                <p className="m-0 mb-1 text-[13px] font-extrabold text-[#0F6B3A]">{W.nuHow}</p>
                <ul className="m-0 list-none p-0">
                    {W.prompts.map((p, i) => (
                        <li key={p.q} className="flex items-center gap-2.5 py-0.5">
                            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[#E4F3EB]"><CategoryIcon name={ICONS[i] ?? 'work'} size={20} /></span>
                            <span className="min-w-0"><span className="block text-[14px] font-bold text-[#1C1917]">{p.q}</span><span className="block text-[12px] text-[#5F6B63]">{p.ex}</span></span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default NothingUnderstood;
