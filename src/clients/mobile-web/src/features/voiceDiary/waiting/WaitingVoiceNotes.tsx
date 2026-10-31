/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59 = 3A, his own design) — the recordings not
 * saved yet, at the top of सेट-अप केंद्र › आवाज नोंदी:
 *
 *   - the top line: "N नोंदी अजून समजलेल्या नाहीत — चांगलं इंटरनेट मिळाल्यावर साथी समजून घेईल. आवाज या फोनमध्ये सुरक्षित
 *     आहे" (or "साथी समजून घेत आहे…", or "N नोंदी समजल्या — प्रत्येकावर दाबा, बघून जतन करा");
 *   - each recording: when he spoke, where, and "अजून समजलं नाही" → "समजून घेत आहे…" → "समजलं — दाबा, बघून जतन करा";
 *   - an understood one opens "तपासा आणि जतन करा" (never the old form); "जतन करा" saves it through the voice save on the
 *     place and the day he meant, and only then is it put down — the number goes down by one.
 *
 * Lane OF fix pass 1:
 *   - M1: one recording never makes two logs — the save carries the job's own once-key (the log ids are derived from it, so
 *     a second try finds the log already written and writes nothing); a failure AFTER the write never says "not saved";
 *     मागे is blocked while saving;
 *   - M2: the page adds no "saved" words of its own — the save says what reached where ("लक्षात ठेवलं ✓ — … शेतनोंदीत जाणार
 *     नाही" when it will not);
 *   - M3: every row can be removed (with a confirm); a finished job with no usable answer says so, with "पुन्हा सांगा";
 *   - M4: a recording the queue gave up on stays, says so, and can be tried again; with its sound gone it says that;
 *   - M5: only this farm's recordings, and never saved on another farm;  L3: English mode is English;  L4: a failed
 *     put-down or remove is said, never swallowed.
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, Loader2, Mic, RotateCcw, Trash2, WifiOff, XCircle } from 'lucide-react';
import type { AgriLogResponse, CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../types';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';
import type { CheckedSave } from '../../../app/hooks/useVoiceAutoSave';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { formatFarmerLogTime } from '../../../core/navigation/helpers';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { requestSpeak, type SpeakPlace, type SpeakReturn } from '../../../core/speak/speakStore';
import type { UnreviewedAiResult } from '../../../infrastructure/sync/PendingAiResultsReader';
import {
    isTypedNote, putDownSavedVoiceNote, removeWaitingVoiceNote, retryWaitingVoiceNote, waitingCounts, type WaitingVoiceNote,
} from '../../../infrastructure/sync/waitingVoiceNotes';
import { logger } from '../../../infrastructure/observability/Logger';
import { PHONE_COLUMN } from '../../logs/components/phoneColumn';
import CheckSaveScreen from '../../logs/components/checkSave/CheckSaveScreen';
import { checkSaveWords } from '../../logs/components/checkSave/checkSaveWords';
import {
    checkCaseOf, guessScope, hasPlace, placeLabel, previewLogs, samePlace, scopeOfLogs, understoodOf,
} from '../../logs/components/checkSave/checkSaveModel';
import { DayPickSheet } from '../../logs/components/dayPick/DayPickSheet';
import { dayFull, dayRel } from '../../logs/components/dayPick/dayWords';
import { PlacePickerSheet } from '../../context/components/PlacePickerSheet';
import { TypedSheet } from '../../voice/components/recorder/TypedEntry';
import { useWaitingVoiceNotes } from './useWaitingVoiceNotes';
import { voiceNotesWords } from './voiceNotesWords';
import { scopeOfJob, voiceNoteDraft } from './voiceNoteDraft';

const SANS = "'Noto Sans Devanagari', sans-serif";
const FARM_GLOBAL = 'FARM_GLOBAL';

/** What opening and saving an understood recording needs from the app (absent: rows are shown, not opened — P5). */
export interface VoiceNoteCheckDeps {
    crops: CropProfile[];
    profile: FarmerProfile;
    history: DailyLog[];
    save: (draft: AgriLogResponse, provenance: LogProvenance | undefined, how: CheckedSave) => Promise<DailyLog[] | null>;
    /** Where "पुन्हा सांगा" brings him back to (this page). */
    returnTo: SpeakReturn;
    /** A line for him; `type` is what it is (a failure goes out as a failure, fix 2 N4). */
    toast: (message: string, type: 'success' | 'error' | 'partial') => void;
    /** The farm open now: a recording made on another farm is never saved here (fix 1, M5). */
    farmId?: string | null;
}

/** One plot or the whole farm as THE mic's known place; several plots: the mic asks (crop → plot). */
const speakPlaceOf = (scope: LogScope | null): SpeakPlace | undefined => {
    if (!scope) return undefined;
    if (scope.selectedCropIds.includes(FARM_GLOBAL)) return { cropId: FARM_GLOBAL };
    return scope.selectedPlotIds.length === 1 && scope.selectedCropIds.length === 1 ? { cropId: scope.selectedCropIds[0], plotId: scope.selectedPlotIds[0] } : undefined;
};

/** The day a recording is for: the past day he chose before speaking, else the day he spoke. */
const dayOfJob = (job: UnreviewedAiResult | WaitingVoiceNote['job']): string =>
    job.context.dateKey ?? getDateKey(job.context.recordedAtUtc ?? job.createdAt);

/**
 * "पुन्हा सांगा" for a recording he wants to say again: THE one mic, on its own place and day; once the new words are SAVED,
 * this recording is put down (so the number never counts it twice).
 */
function speakAgainFor(note: WaitingVoiceNote, deps: { crops: CropProfile[]; returnTo: SpeakReturn }, onPutDownFailed: () => void, text?: string): void {
    const day = dayOfJob(note.job);
    const todayKey = getDateKey();
    const place = speakPlaceOf(scopeOfJob(note.job as UnreviewedAiResult, deps.crops));
    // Fix 2 (N7): a day AFTER today (the phone's clock was ahead) is no day at all — the mic opens on today, as always.
    requestSpeak({
        purpose: 'addToDay',
        context: { ...(place && { place }), ...(day < todayKey && { date: day }), ...(text && { typed: text }) },
        returnTo: deps.returnTo,
        onLanded: landing => {
            if (landing.kind !== 'saved') return;
            void removeWaitingVoiceNote(note).catch(error => { logger.warn('voice note: could not be put down after it was said again', { error: String(error) }); onPutDownFailed(); });
        },
    });
}

const NoteCheck: React.FC<{ note: WaitingVoiceNote; deps: VoiceNoteCheckDeps; language: string | undefined; onClose: () => void }> = ({ note, deps, language, onClose }) => {
    const job = note.job as UnreviewedAiResult;
    const w = checkSaveWords(language);
    const vw = voiceNotesWords(language);
    const todayKey = getDateKey();
    const draft = useMemo(() => voiceNoteDraft(job, deps.crops), [job, deps.crops]);
    const kind = draft ? checkCaseOf(draft.draft, undefined) : 'unclear';
    const [chosen, setChosen] = useState<LogScope | null>(kind === 'otherPlot' ? null : draft?.scope ?? null);
    const [day, setDay] = useState<string>(draft?.dayKey ?? todayKey);
    const [open, setOpen] = useState<'place' | 'day' | 'type' | null>(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState<'save' | 'clear' | null>(null);
    const [alreadyAt, setAlreadyAt] = useState<string | null>(null);
    const logs = useMemo(() => (draft ? previewLogs(draft.draft, chosen, deps.crops, deps.profile) : []), [draft, chosen, deps.crops, deps.profile]);
    const understood = useMemo(() => understoodOf(logs, language), [logs, language]);
    // मागे is blocked while saving (fix 1, M1): the save finishes, or says what went wrong, before he leaves.
    useBackDismiss(open === null && !saving, onClose);
    if (!draft) return null;
    const otherFarm = !!job.context.farmId && !!deps.farmId && job.context.farmId !== deps.farmId;
    // Fix 2 (N7): a day after today means the phone's clock was ahead when he spoke — the day is not known; he picks it.
    const needsDay = day > todayKey;

    const save = () => {
        if (!hasPlace(chosen) || saving || otherFarm || needsDay) return;
        setSaving(true);
        setFailed(null);
        setAlreadyAt(null);
        // The job's own key: a second try makes the same log ids, finds them written, and writes nothing again (M1).
        const onceKey = `pending-ai-job:${job.id}:${job.createdAt}`;
        void deps.save(draft.draft, draft.provenance, { scope: chosen, dateKey: day, recording: draft.recording, stayOnScreen: true, onceKey })
            .then(async written => {
                if (!written) { setSaving(false); setFailed('save'); return; }
                // Fix 2 (N1): an earlier try already saved it — on the place and day chosen THEN. A changed choice is never
                // pretended saved: he is told where it is, and the recording only leaves the list.
                const at = scopeOfLogs(written);
                const savedDay = written[0]?.date ?? day;
                const elsewhere = (!!at && !samePlace(at, chosen)) || savedDay !== day
                    ? vw.alreadySavedAt(placeLabel(at, deps.crops, language, w.wholeFarm), dayFull(savedDay, language)) : null;
                try {
                    await putDownSavedVoiceNote(job.id);
                } catch (error) {
                    // The log IS written: never "not saved". Pressing again finds it written and only clears the list.
                    logger.warn('voice note: saved, but could not be put down', { error: String(error) });
                    setSaving(false);
                    setFailed('clear');
                    setAlreadyAt(elsewhere);
                    return;
                }
                if (elsewhere) deps.toast(elsewhere, 'partial');
                onClose();
            })
            .catch(error => { logger.error('voice note save failed', error); setSaving(false); setFailed('save'); });
    };
    const guess = guessScope(draft.draft);
    const daysWithRecords = new Set(deps.history.map(l => l.date));
    return (
        <div className="fixed inset-0 z-[70] flex justify-center bg-stone-900/30" data-testid="voice-note-check">
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={onClose} disabled={saving} data-testid="voice-note-check-back"
                        className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95 disabled:opacity-50">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                        <span className="text-[17px] font-extrabold">{w.back}</span>
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3">
                    {otherFarm && <p className="m-0 mb-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[15px] font-bold text-amber-950" data-testid="voice-note-wrong-farm">{vw.wrongFarm}</p>}
                    <CheckSaveScreen
                        kind={kind}
                        transcript={(draft.draft.fullTranscript ?? job.context.textTranscript ?? '').trim()}
                        typed={draft.typed}
                        spokenAt={formatFarmerLogTime(draft.recording.recordedAtUtc) || undefined}
                        understood={understood}
                        placeLabel={placeLabel(chosen, deps.crops, language, w.wholeFarm)}
                        chosenLabel={placeLabel(draft.scope, deps.crops, language, w.wholeFarm)}
                        guessLabel={placeLabel(guess, deps.crops, language, w.wholeFarm)}
                        dayLabel={needsDay ? vw.chooseDay : dayRel(day, todayKey, language)}
                        dayNote={needsDay ? vw.phoneAhead : day !== todayKey ? w.dayNote(dayFull(day, language)) : undefined}
                        needsDay={needsDay}
                        saving={saving}
                        saveFailed={failed === 'save'}
                        kept={!draft.typed}
                        onSayAgain={() => { onClose(); speakAgainFor(note, deps, () => deps.toast(vw.removeFailed, 'error')); }}
                        onType={() => setOpen('type')}
                        onPickPlace={() => setOpen('place')}
                        onPickDay={() => setOpen('day')}
                        onSave={save}
                    />
                    {alreadyAt && <p className="m-0 mt-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[14.5px] font-bold text-amber-950" data-testid="voice-note-already-saved">{alreadyAt}</p>}
                    {failed === 'clear' && <p className="m-0 mt-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[14.5px] font-bold text-amber-950" data-testid="voice-note-saved-not-cleared">{vw.savedNotCleared}</p>}
                </div>
            </div>
            {open === 'place' && (
                <PlacePickerSheet crops={deps.crops}
                    marked={guess ? { plotIds: guess.selectedPlotIds, label: w.guessTag } : draft.scope ? { plotIds: draft.scope.selectedPlotIds, label: w.nowTag } : undefined}
                    forDay={day !== todayKey && !needsDay ? dayRel(day, todayKey, language) : undefined}
                    onPick={scope => { setChosen(scope); setOpen(null); }} onClose={() => setOpen(null)} />
            )}
            {open === 'day' && (
                <DayPickSheet value={needsDay ? todayKey : day} note={w.dayFor} hasRecords={key => daysWithRecords.has(key)} todayKey={todayKey}
                    onPick={key => { setDay(key); setOpen(null); }} onClose={() => setOpen(null)} />
            )}
            {open === 'type' && <TypedSheet onClose={() => setOpen(null)} onSend={text => { setOpen(null); onClose(); speakAgainFor(note, deps, () => deps.toast(vw.removeFailed, 'error'), text); }} />}
        </div>
    );
};

const Chip: React.FC<{ state: WaitingVoiceNote['state']; why?: WaitingVoiceNote['why']; testId: string; language: string | undefined }> = ({ state, why, testId, language }) => {
    const vw = voiceNotesWords(language);
    const base = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12.5px] font-extrabold';
    if (state === 'pending') return <span data-testid={testId} data-state={state} className={`${base} border-amber-300 bg-amber-50 text-amber-900`}><WifiOff size={13} aria-hidden="true" />{vw.chipPending}</span>;
    if (state === 'working') return <span data-testid={testId} data-state={state} className={`${base} border-sky-300 bg-sky-50 text-sky-900`}><Loader2 size={13} className="animate-spin" aria-hidden="true" />{vw.chipWorking}</span>;
    if (state === 'understood') return <span data-testid={testId} data-state={state} className={`${base} border-emerald-300 bg-emerald-50 text-emerald-900`}><CheckCircle2 size={13} aria-hidden="true" />{vw.chipUnderstood}</span>;
    // Fix 2 (N3): "साथीला समजलं नाही" only when the server answered and could not; a weak connection is said as that.
    const stuck = why === 'notSent' ? vw.chipNotSent : why === 'notUnderstood' ? vw.chipNotUnderstood : vw.chipStuck;
    const words = state === 'stuck' ? stuck : state === 'lost' ? vw.chipLost : vw.cannotOpen;
    return <span data-testid={testId} data-state={state} className={`${base} border-red-300 bg-red-50 text-red-900`}><XCircle size={13} aria-hidden="true" />{words}</span>;
};

const SmallButton: React.FC<{ onClick: () => void; testId: string; children: React.ReactNode }> = ({ onClick, testId, children }) => (
    <button type="button" onClick={e => { e.stopPropagation(); onClick(); }} data-testid={testId}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-stone-300 bg-white px-3 text-[14px] font-extrabold text-stone-700">
        {children}
    </button>
);

/** `language`: the page's own (it reads the app language itself). */
export const WaitingVoiceNotes: React.FC<{ deps?: VoiceNoteCheckDeps; language?: string }> = ({ deps, language }) => {
    const vw = voiceNotesWords(language);
    const w = checkSaveWords(language);
    const { notes, refresh } = useWaitingVoiceNotes();
    const [openId, setOpenId] = useState<number | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const openNote = notes.find(n => n.jobId === openId) ?? null;
    if (notes.length === 0) return null;
    const c = waitingCounts(notes);
    const anyLost = notes.some(n => n.state === 'lost');
    const top = c.working > 0
        ? { tone: 'border-sky-300 bg-sky-50 text-sky-950', title: vw.topWorking, body: vw.topWorkingBody }
        : c.notYet > 0
            ? { tone: 'border-amber-300 bg-amber-50 text-amber-950', title: vw.topNotYet(c.notYet), body: anyLost ? vw.topNotYetBodyPlain : vw.topNotYetBody }
            : c.stuck > 0
                ? { tone: 'border-red-300 bg-red-50 text-red-950', title: vw.topStuck(c.stuck), body: vw.topStuckBody }
                : { tone: 'border-emerald-300 bg-emerald-50 text-emerald-950', title: vw.topUnderstood(c.understood), body: vw.topUnderstoodBody };

    const remove = (note: WaitingVoiceNote) => {
        if (!window.confirm(isTypedNote(note.job) ? vw.removeConfirmTyped : vw.removeConfirm)) return;
        setProblem(null);
        void removeWaitingVoiceNote(note).catch(error => { logger.warn('voice note could not be removed', { error: String(error) }); setProblem(vw.removeFailed); });
    };
    const retry = (note: WaitingVoiceNote) => {
        setProblem(null);
        void retryWaitingVoiceNote(note.jobId).catch(error => { logger.warn('voice note could not be put back in the queue', { error: String(error) }); setProblem(vw.retryFailed); });
    };
    return (
        <section className="space-y-2" data-testid="voice-notes-waiting" style={{ fontFamily: SANS }}>
            <div className={`rounded-2xl border-2 p-3 text-[15px] font-bold leading-snug ${top.tone}`} data-testid="voice-notes-top">
                <p className="m-0 flex items-center gap-1.5 font-extrabold"><Mic size={18} aria-hidden="true" />{top.title}</p>
                <p className="m-0 mt-0.5">{top.body}</p>
            </div>
            {problem && <p className="m-0 rounded-xl bg-red-50 p-2.5 text-[14px] font-bold text-red-800" data-testid="voice-notes-problem">{problem}</p>}
            {notes.map(n => {
                const tappable = n.state === 'understood' && !!deps;
                const place = deps ? placeLabel(scopeOfJob(n.job as UnreviewedAiResult, deps.crops), deps.crops, language, w.wholeFarm) : '';
                const head = (
                    <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-extrabold text-stone-900">{formatFarmerLogTime(n.spokenAtUtc)}{place ? ` · ${place}` : ''}</span>
                        <span className="mt-1 block"><Chip state={n.state} why={n.why} testId={`voice-note-state-${n.jobId}`} language={language} /></span>
                    </span>
                );
                return (
                    <div key={n.jobId} data-testid={`voice-note-${n.jobId}`}
                        {...(tappable && { role: 'button', tabIndex: 0, onClick: () => setOpenId(n.jobId), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') setOpenId(n.jobId); } })}
                        className={`rounded-2xl bg-white p-3 ${tappable ? 'cursor-pointer border-2 border-emerald-300 active:scale-[0.99]' : 'border border-stone-200'}`}>
                        <div className="flex items-center gap-2">{head}{tappable && <ChevronRight size={20} className="shrink-0 text-emerald-700" aria-hidden="true" />}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {n.state === 'stuck' && <SmallButton onClick={() => retry(n)} testId={`voice-note-retry-${n.jobId}`}><RotateCcw size={15} aria-hidden="true" />{vw.retry}</SmallButton>}
                            {(n.state === 'unusable' || n.state === 'lost') && deps && (
                                <SmallButton onClick={() => speakAgainFor(n, deps, () => setProblem(vw.removeFailed))} testId={`voice-note-again-${n.jobId}`}><Mic size={15} aria-hidden="true" />{vw.sayAgain}</SmallButton>
                            )}
                            <SmallButton onClick={() => remove(n)} testId={`voice-note-remove-${n.jobId}`}><Trash2 size={15} aria-hidden="true" />{vw.remove}</SmallButton>
                        </div>
                    </div>
                );
            })}
            {openNote && deps && <NoteCheck note={openNote} deps={deps} language={language} onClose={() => { setOpenId(null); refresh(); }} />}
        </section>
    );
};

export default WaitingVoiceNotes;
