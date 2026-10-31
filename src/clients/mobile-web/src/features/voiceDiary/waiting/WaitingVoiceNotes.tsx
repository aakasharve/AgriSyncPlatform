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
 *   - an understood one opens "तपासा आणि जतन करा" (the same screen a parse not saved by itself shows — never the old
 *     form); "जतन करा" saves it through the voice save on the place and the day he meant, and only then is it put down
 *     (`markAiResultReviewed`) — the number goes down by one.
 * The rows, the gear's number and the row's number all come from THE one reader (`useWaitingVoiceNotes`).
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, Loader2, Mic, Trash2, WifiOff } from 'lucide-react';
import type { AgriLogResponse, CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../types';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';
import type { CheckedSave } from '../../../app/hooks/useVoiceAutoSave';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { formatFarmerLogTime } from '../../../core/navigation/helpers';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { requestSpeak, type SpeakPlace, type SpeakReturn } from '../../../core/speak/speakStore';
import { markAiResultReviewed, type UnreviewedAiResult } from '../../../infrastructure/sync/PendingAiResultsReader';
import { noteVoiceNotesChanged, waitingCounts, type WaitingVoiceNote } from '../../../infrastructure/sync/waitingVoiceNotes';
import { logger } from '../../../infrastructure/observability/Logger';
import { PHONE_COLUMN } from '../../logs/components/phoneColumn';
import CheckSaveScreen from '../../logs/components/checkSave/CheckSaveScreen';
import { checkSaveWords } from '../../logs/components/checkSave/checkSaveWords';
import { checkCaseOf, guessScope, hasPlace, placeLabel, previewLogs, understoodOf } from '../../logs/components/checkSave/checkSaveModel';
import { DayPickSheet } from '../../logs/components/dayPick/DayPickSheet';
import { dayFull, dayRel } from '../../logs/components/dayPick/dayWords';
import { PlacePickerSheet } from '../../context/components/PlacePickerSheet';
import { TypedSheet } from '../../voice/components/recorder/TypedEntry';
import { discardConfirmMessage, DRAFTS_DISCARD } from '../../../pages/aiDraftsCopy';
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
    toast: (message: string) => void;
}

/** One plot or the whole farm as THE mic's known place; several plots: the mic asks (crop → plot). */
const speakPlaceOf = (scope: LogScope | null): SpeakPlace | undefined => {
    if (!scope) return undefined;
    if (scope.selectedCropIds.includes(FARM_GLOBAL)) return { cropId: FARM_GLOBAL };
    return scope.selectedPlotIds.length === 1 && scope.selectedCropIds.length === 1 ? { cropId: scope.selectedCropIds[0], plotId: scope.selectedPlotIds[0] } : undefined;
};

const NoteCheck: React.FC<{ job: UnreviewedAiResult; deps: VoiceNoteCheckDeps; onClose: () => void }> = ({ job, deps, onClose }) => {
    const language = useOptionalLanguage()?.language;
    const w = checkSaveWords(language);
    const vw = voiceNotesWords(language);
    const todayKey = getDateKey();
    const note = useMemo(() => voiceNoteDraft(job, deps.crops), [job, deps.crops]);
    const kind = note ? checkCaseOf(note.draft, undefined) : 'unclear';
    const [chosen, setChosen] = useState<LogScope | null>(kind === 'otherPlot' ? null : note?.scope ?? null);
    const [day, setDay] = useState<string>(note?.dayKey ?? todayKey);
    const [open, setOpen] = useState<'place' | 'day' | 'type' | null>(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const logs = useMemo(() => (note ? previewLogs(note.draft, chosen, deps.crops, deps.profile) : []), [note, chosen, deps.crops, deps.profile]);
    const understood = useMemo(() => understoodOf(logs, language), [logs, language]);
    useBackDismiss(open === null && !saving, onClose);
    if (!note) return null;

    const putDown = async () => {
        await markAiResultReviewed(job.id);
        noteVoiceNotesChanged();
    };
    const save = () => {
        if (!hasPlace(chosen) || saving) return;
        setSaving(true);
        setFailed(false);
        void deps.save(note.draft, note.provenance, { scope: chosen, dateKey: day, recording: note.recording, stayOnScreen: true })
            .then(async written => {
                if (!written) { setSaving(false); setFailed(true); return; }
                // Saved: only now is the recording put down (the number goes down by one).
                await putDown();
                deps.toast(vw.saved);
                onClose();
            })
            .catch(error => { logger.error('voice note save failed', error); setSaving(false); setFailed(true); });
    };
    // Nothing understood in it: say it again (THE one mic, same place and day); once that is saved, this one is put down.
    const speakAgain = (text?: string) => {
        const place = speakPlaceOf(note.scope);
        onClose();
        requestSpeak({
            purpose: 'addToDay',
            context: { ...(place && { place }), ...(day !== todayKey && { date: day }), ...(text && { typed: text }) },
            returnTo: deps.returnTo,
            onLanded: landing => { if (landing.kind === 'saved') void putDown(); },
        });
    };
    const discard = () => {
        if (!window.confirm(discardConfirmMessage(job))) return;
        void putDown().then(onClose);
    };
    const guess = guessScope(note.draft);
    const daysWithRecords = new Set(deps.history.map(l => l.date));
    return (
        <div className="fixed inset-0 z-[70] flex justify-center bg-stone-900/30" data-testid="voice-note-check">
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={onClose} data-testid="voice-note-check-back"
                        className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                        <span className="text-[17px] font-extrabold">{w.back}</span>
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3">
                    <CheckSaveScreen
                        kind={kind}
                        transcript={(note.draft.fullTranscript ?? job.context.textTranscript ?? '').trim()}
                        typed={note.typed}
                        spokenAt={formatFarmerLogTime(note.recording.recordedAtUtc) || undefined}
                        understood={understood}
                        placeLabel={placeLabel(chosen, deps.crops, language, w.wholeFarm)}
                        chosenLabel={placeLabel(note.scope, deps.crops, language, w.wholeFarm)}
                        guessLabel={placeLabel(guess, deps.crops, language, w.wholeFarm)}
                        dayLabel={dayRel(day, todayKey, language)}
                        dayNote={day !== todayKey ? w.dayNote(dayFull(day, language)) : undefined}
                        saving={saving}
                        saveFailed={failed}
                        kept={!note.typed}
                        onSayAgain={() => speakAgain()}
                        onType={() => setOpen('type')}
                        onPickPlace={() => setOpen('place')}
                        onPickDay={() => setOpen('day')}
                        onSave={save}
                    />
                    {kind === 'unclear' && (
                        <button type="button" onClick={discard} data-testid="voice-note-discard"
                            className="mx-auto mt-2 flex min-h-[48px] items-center gap-1.5 rounded-full border border-stone-300 bg-white px-4 text-[15px] font-bold text-stone-700">
                            <Trash2 size={16} aria-hidden="true" />{DRAFTS_DISCARD}
                        </button>
                    )}
                </div>
            </div>
            {open === 'place' && (
                <PlacePickerSheet crops={deps.crops}
                    marked={guess ? { plotIds: guess.selectedPlotIds, label: w.guessTag } : note.scope ? { plotIds: note.scope.selectedPlotIds, label: w.nowTag } : undefined}
                    forDay={day !== todayKey ? dayRel(day, todayKey, language) : undefined}
                    onPick={scope => { setChosen(scope); setOpen(null); }} onClose={() => setOpen(null)} />
            )}
            {open === 'day' && (
                <DayPickSheet value={day} note={w.dayFor} hasRecords={key => daysWithRecords.has(key)} todayKey={todayKey}
                    onPick={key => { setDay(key); setOpen(null); }} onClose={() => setOpen(null)} />
            )}
            {open === 'type' && <TypedSheet onClose={() => setOpen(null)} onSend={text => { setOpen(null); speakAgain(text); }} />}
        </div>
    );
};

const Chip: React.FC<{ state: WaitingVoiceNote['state']; testId: string; language: string | undefined }> = ({ state, testId, language }) => {
    const vw = voiceNotesWords(language);
    if (state === 'pending') return <span data-testid={testId} data-state={state} className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[12.5px] font-extrabold text-amber-900"><WifiOff size={13} aria-hidden="true" />{vw.chipPending}</span>;
    if (state === 'working') return <span data-testid={testId} data-state={state} className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[12.5px] font-extrabold text-sky-900"><Loader2 size={13} className="animate-spin" aria-hidden="true" />{vw.chipWorking}</span>;
    return <span data-testid={testId} data-state={state} className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[12.5px] font-extrabold text-emerald-900"><CheckCircle2 size={13} aria-hidden="true" />{vw.chipUnderstood}</span>;
};

/** `language`: the page's own (it reads the app language itself). */
export const WaitingVoiceNotes: React.FC<{ deps?: VoiceNoteCheckDeps; language?: string }> = ({ deps, language }) => {
    const vw = voiceNotesWords(language);
    const w = checkSaveWords(language);
    const { notes, refresh } = useWaitingVoiceNotes();
    const [openJob, setOpenJob] = useState<UnreviewedAiResult | null>(null);
    if (notes.length === 0) return null;
    const c = waitingCounts(notes);
    const top = c.working > 0
        ? { tone: 'border-sky-300 bg-sky-50 text-sky-950', title: vw.topWorking, body: vw.topWorkingBody }
        : c.notYet > 0
            ? { tone: 'border-amber-300 bg-amber-50 text-amber-950', title: vw.topNotYet(c.notYet), body: vw.topNotYetBody }
            : { tone: 'border-emerald-300 bg-emerald-50 text-emerald-950', title: vw.topUnderstood(c.understood), body: vw.topUnderstoodBody };
    return (
        <section className="space-y-2" data-testid="voice-notes-waiting" style={{ fontFamily: SANS }}>
            <div className={`rounded-2xl border-2 p-3 text-[15px] font-bold leading-snug ${top.tone}`} data-testid="voice-notes-top">
                <p className="m-0 flex items-center gap-1.5 font-extrabold"><Mic size={18} aria-hidden="true" />{top.title}</p>
                <p className="m-0 mt-0.5">{top.body}</p>
            </div>
            {notes.map(n => {
                const tappable = n.state === 'understood' && !!deps;
                const place = deps ? placeLabel(scopeOfJob(n.job as UnreviewedAiResult, deps.crops), deps.crops, language, w.wholeFarm) : '';
                const body = (
                    <>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-extrabold text-stone-900">{formatFarmerLogTime(n.spokenAtUtc)}{place ? ` · ${place}` : ''}</span>
                            <span className="mt-1 block"><Chip state={n.state} testId={`voice-note-state-${n.jobId}`} language={language} /></span>
                        </span>
                        {tappable && <ChevronRight size={20} className="shrink-0 text-emerald-700" aria-hidden="true" />}
                    </>
                );
                return tappable ? (
                    <button key={n.jobId} type="button" onClick={() => setOpenJob(n.job as UnreviewedAiResult)} data-testid={`voice-note-${n.jobId}`}
                        className="flex w-full items-center gap-2 rounded-2xl border-2 border-emerald-300 bg-white p-3 text-left active:scale-[0.99]">{body}</button>
                ) : (
                    <div key={n.jobId} data-testid={`voice-note-${n.jobId}`} className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white p-3">{body}</div>
                );
            })}
            {openJob && deps && <NoteCheck job={openJob} deps={deps} onClose={() => { setOpenJob(null); refresh(); }} />}
        </section>
    );
};

export default WaitingVoiceNotes;
