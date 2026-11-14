/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4 + CMP-D3; D-68 round 2/3, D-66, D-69, R12; P3, P4, P10)
 *
 * "तुमचं स्वतःचं काम": one record of work in none of his schedules, and the OPTIONAL reason he may give ("का केलं"): three picture
 * choices (Practice / Extra / Weather), his typed words, and the mic. A reason is kept ON the existing record, never new work: it is
 * queued through `SetLogReasonCommand` (works with no internet, arrives once; the server decides who may and keeps the latest).
 *
 *   - A picture tap saves at once (the picture alone is enough, offline too), with the words that are in the box at that moment.
 *   - Words alone are saved with the "जतन करा" button, under the picture chosen. `saidByVoice` is true ONLY while the words are still
 *     exactly what the mic heard (an edit makes them typed words).
 *   - The mic is the log's own batch recorder + the live route `/shramsafal/ai/voice-parse` (`understandPlanSpeech`), KEEPING ONLY THE
 *     TRANSCRIPT, which lands in the words box for him to see and save. ONLINE ONLY: offline the mic is not offered and the sheet says the
 *     spoken words need the internet. It never promises that words will wait with the sound (P10).
 *   - What the server served is shown (`reason`): the kind's picture, and his words ONLY when the server served words.
 * A record the server could not read (`notRecognised`) is never shown here: it never gets the choices (R12).
 */
import React, { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { AudioData, CropProfile, FarmerProfile } from '../../types';
import { LOG_REASON_MAX_WORDS, SetLogReasonCommand, type LogReasonKind } from '../../application/usecases/sync/SetLogReasonCommand';
import { understandPlanSpeech } from '../plannedWork/data/planVoice';
import PlanMic from '../plannedWork/components/PlanMic';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { KIND_ICON, PartIcon } from './compareBits';
import { n } from './compareWords';
import { SheetShell, type SheetContext, type ShownReason } from './CompareSheets';
import type { OwnWorkDto } from './compareFacts';

const KINDS: readonly LogReasonKind[] = ['Practice', 'Extra', 'Weather'];
const EMPTY_PROFILE = { operators: [], activeOperatorId: '', motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;

type Mic = 'idle' | 'working' | 'failed';

export const OwnWorkSheet: React.FC<{
    ctx: SheetContext;
    own: OwnWorkDto;
    farmId: string;
    online: boolean;
    crops: CropProfile[];
    profile?: FarmerProfile;
    onKept: (own: OwnWorkDto, reason: ShownReason) => void;
    onClose: () => void;
    onBack?: () => void;
}> = ({ ctx, own, farmId, online, crops, profile, onKept, onClose, onBack }) => {
    const { words, lang } = ctx;
    const shown = ctx.reasonOf(own);
    const [kind, setKind] = useState<LogReasonKind | null>(shown?.kind ?? null);
    const [text, setText] = useState(shown?.words ?? '');
    const heard = useRef<string | null>(shown?.saidByVoice ? (shown.words ?? null) : null);
    const [mic, setMic] = useState<Mic>('idle');
    const [failed, setFailed] = useState(false);
    const kept = useRef<{ kind: LogReasonKind; words: string } | null>(shown ? { kind: shown.kind, words: shown.words ?? '' } : null);

    const keep = async (k: LogReasonKind, rawWords: string) => {
        const wordsTrim = rawWords.trim();
        if (kept.current && kept.current.kind === k && kept.current.words === wordsTrim) return; // the same reason again is not a new one
        const byVoice = wordsTrim !== '' && heard.current !== null && heard.current.trim() === wordsTrim;
        // marked BEFORE the await so a second quick tap is the same reason; put back if the save fails
        const before = kept.current;
        kept.current = { kind: k, words: wordsTrim };
        try {
            await SetLogReasonCommand.enqueue({
                farmId, dailyLogId: own.dailyLogId, workKey: own.workKey, kind: k,
                ...(wordsTrim ? { words: wordsTrim } : {}), saidByVoice: byVoice, reasonId: idGenerator.generate(),
            });
            setFailed(false);
            onKept(own, { kind: k, words: wordsTrim || null, saidByVoice: byVoice });
        } catch {
            kept.current = before;
            setFailed(true);
        }
    };

    const listen = async (audio: AudioData) => {
        setMic('working');
        const result = await understandPlanSpeech(audio, { crops, profile: profile ?? EMPTY_PROFILE });
        // ONLY what he said: `speech.words` is empty when the parse heard no transcript (then `transcript` is a task title, never his words);
        // whatever the parse also found (a planned task, a cue) is dropped. Cut to the server's limit so the save cannot be refused for length.
        const said = result.ok ? (result.speech.words ?? '').trim().slice(0, LOG_REASON_MAX_WORDS) : '';
        if (!said) { setMic('failed'); return; }
        heard.current = said;
        setText(said);
        setMic('idle');
    };

    const typed = text.trim();
    const canSaveWords = kind !== null && typed !== '' && !(kept.current && kept.current.kind === kind && kept.current.words === typed);
    const savedKind = kept.current?.kind ?? null;
    const savedWords = kept.current?.words ?? '';
    const stageDay = words.ownWhen(own.day);

    return (
        <SheetShell title={own.title ? own.title : words.oneRecord} subtitle={words.notInScheduleDidIt} icon={<PartIcon part="own" size={18} />} words={words} onClose={onClose} onBack={onBack} testId="compare-own-sheet">
            <p className="m-0 text-[16px] font-bold leading-snug text-stone-900" data-testid="compare-own-sentence">{words.ownSentence}</p>
            <p className="m-0 mt-1.5 text-[15px] font-extrabold text-stone-700">{stageDay} · {words.step2Records} {n(lang, 1)}</p>

            {savedKind && (
                <div className="mt-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2" data-testid="compare-own-saved">
                    <b className="flex items-center gap-2 text-[16px] text-emerald-900">
                        {React.createElement(KIND_ICON[savedKind], { size: 18, 'aria-hidden': true })}{words.kinds[savedKind]}
                    </b>
                    {savedWords && <div className="mt-1 text-[15px] font-semibold text-stone-900" data-testid="compare-own-saved-words">“{savedWords}”{heard.current !== null && heard.current.trim() === savedWords && <> · {words.spokenTag}</>}</div>}
                </div>
            )}

            <p className="m-0 mt-3 text-[15px] font-extrabold text-stone-700">{words.optionalWhy}</p>
            <div role="radiogroup" aria-label={words.reasonGroup} className="mt-2 grid grid-cols-3 gap-2" data-testid="compare-reason-choices">
                {KINDS.map(k => {
                    const Icon = KIND_ICON[k];
                    const on = kind === k;
                    return (
                        <button key={k} type="button" role="radio" aria-checked={on} data-testid={`compare-reason-${k}`}
                            onClick={() => { setKind(k); void keep(k, text); }}
                            className={`relative flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 py-2 text-center text-[14px] font-extrabold leading-tight ${on ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-stone-300 bg-white text-stone-800'}`}>
                            {on && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-700 text-white"><Check size={12} strokeWidth={4} aria-hidden="true" /></span>}
                            <Icon size={26} aria-hidden="true" />{words.kinds[k]}
                        </button>
                    );
                })}
            </div>

            <textarea value={text} onChange={e => setText(e.target.value)} placeholder={words.wordsPlaceholder} aria-label={words.wordsLabel} maxLength={1000} rows={3}
                data-testid="compare-reason-words"
                className="mt-3 w-full rounded-2xl border-2 border-stone-300 bg-white px-3 py-2 text-[16px] font-semibold text-stone-900" />
            {typed !== '' && kind === null && <p className="m-0 mt-1 text-[14px] font-bold text-stone-700" data-testid="compare-pick-first">{words.pickPictureFirst}</p>}
            <button type="button" disabled={!canSaveWords} onClick={() => { if (kind) void keep(kind, text); }} data-testid="compare-reason-save"
                className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-emerald-700 px-4 text-[16px] font-extrabold text-white disabled:bg-stone-300 disabled:text-stone-600">
                {words.saveWords}
            </button>
            {failed && <p className="m-0 mt-1 text-[14px] font-bold text-stone-700" data-testid="compare-reason-failed" role="status">{words.saveFailed}</p>}

            {online ? (
                <div className="mt-3" data-testid="compare-mic-block">
                    <p className="m-0 mb-1 text-[15px] font-extrabold text-stone-800">{words.micLabel}</p>
                    <PlanMic onAudio={audio => { void listen(audio); }} onProcessingStart={() => setMic('working')} disabled={mic === 'working'} />
                    {mic === 'working' && <p className="m-0 mt-1 text-[14px] font-bold text-stone-700" role="status">{words.micWorking}</p>}
                    {mic === 'failed' && <p className="m-0 mt-1 text-[14px] font-bold text-stone-700" role="status" data-testid="compare-mic-failed">{words.micFailed}</p>}
                    <p className="m-0 mt-1 text-[14px] font-semibold text-stone-600">{words.pictureEnough}</p>
                </div>
            ) : (
                <p className="m-0 mt-3 rounded-xl bg-stone-100 px-3 py-2 text-[14px] font-bold text-stone-800" data-testid="compare-mic-offline">{words.micOfflineNote}</p>
            )}
        </SheetShell>
    );
};

export default OwnWorkSheet;
