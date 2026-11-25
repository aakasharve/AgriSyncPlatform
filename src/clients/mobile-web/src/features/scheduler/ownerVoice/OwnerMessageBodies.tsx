// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; approved spec "Owner's voice") - what goes INSIDE the owner's cards of the one day-card renderer (the deck draws the
// card shell around them): the tip's play buttons on a work's card, the change card (before / now / decide) and the look card (two answers, then the follow-up clip).
// A message changes nothing by itself: every button here only QUEUES the farmer's own decision, and a decision is shown as taken only when the server's row is back.
import React, { useEffect, useState } from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { doseLines } from '../dayCards/dayCardsModel';
import { timingText } from '../dayCards/dayCardTiming';
import { loadDayCards } from '../dayCards/dayCardsStore';
import type { DayCardTask, DayCardsDetail } from '../dayCards/dayCardsTypes';
import type { DayCardWords } from '../dayCards/dayCardWords';
import { useTakeState } from '../ownSchedule/takeIntoMySchedule';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { OwnerClipPlay } from './OwnerClipPlay';
import { OwnerVoiceCommands } from './ownerVoiceCommands';
import { answerOf, isHeard, standingOf, tipsOfTask } from './ownerVoiceModel';
import type { OwnerDecision, OwnerMessage, OwnerVoiceHost, OwnerVoiceView } from './ownerVoiceTypes';
import { ownerVoiceWords, type OwnerVoiceWords } from './ownerVoiceWords';
import { useOwnerAutoPlayId } from './useOwnerVoice';

export interface OwnerVoiceProps { host: OwnerVoiceHost; view: OwnerVoiceView }

const useWords = (): OwnerVoiceWords => ownerVoiceWords(useOptionalLanguage()?.language === 'en' ? 'en' : 'mr');
const nudge = () => { backgroundSyncWorker.triggerNow().catch(() => undefined); };

/**
 * The play button of a message's own clip: the first full play queues "heard" (once; an already heard message queues nothing). The message the farmer tapped "ऐका" for
 * starts by itself (design: "Listen on the orange line. The clip plays on its own card").
 */
const MessagePlay: React.FC<{ message: OwnerMessage; voice: OwnerVoiceProps; words: OwnerVoiceWords; testId: string; notFetchedTestId: string }> = ({ message, voice, words, testId, notFetchedTestId }) => {
    const autoPlayId = useOwnerAutoPlayId();
    return (
        <OwnerClipPlay clipId={message.clipId} kept={voice.view.keptClips.has(message.clipId)} words={words} testId={testId} notFetchedTestId={notFetchedTestId}
            autoStart={autoPlayId === message.id}
            onFullPlay={() => { if (!isHeard(voice.view, voice.host.plotId, message.id)) void OwnerVoiceCommands.heard(voice.host, message.id).then(nudge, () => undefined); }} />
    );
};

/** A tip: a play button on the card of the work it is about. */
export const TipPlays: React.FC<{ detail: DayCardsDetail; taskKey: string; voice: OwnerVoiceProps }> = ({ detail, taskKey, voice }) => {
    const words = useWords();
    const tips = tipsOfTask(voice.view.messages, detail.templateId, taskKey);
    if (tips.length === 0) return null;
    return (
        <div className="space-y-2" data-testid="tips">
            {tips.map(m => (
                <div key={m.id} className="space-y-1 rounded-2xl bg-orange-50 px-3 py-2">
                    <p className="m-0 text-[13px] font-extrabold text-orange-900">{words.tipChip}</p>
                    <MessagePlay message={m} voice={voice} words={words} testId={`tip-play-${m.id}`} notFetchedTestId={`tip-not-fetched-${m.id}`} />
                </div>
            ))}
        </div>
    );
};

// ---- the change card --------------------------------------------------------------------------------------------------------------------------------------------------

type NowState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'unchecked' } | { kind: 'ok'; task: DayCardTask; detail: DayCardsDetail };

/** The "now": the same work in the CHECKED new version, from this phone's copy first (the server when there is signal). Never invented: absent is said so. */
function useNow(message: OwnerMessage): NowState {
    const [now, setNow] = useState<NowState>({ kind: 'loading' });
    useEffect(() => {
        let alive = true;
        setNow({ kind: 'loading' });
        const id = message.newVersionId;
        if (!id) { setNow({ kind: 'missing' }); return undefined; }
        void loadDayCards(id).then(r => {
            if (!alive) return;
            if (!r.ok) { setNow({ kind: 'missing' }); return; }
            const task = r.detail.tasks.find(t => t.task.taskKey === message.taskKey);
            if (!task) setNow({ kind: 'missing' });
            else if (r.detail.kind !== 'reference' || !r.detail.check.isChecked) setNow({ kind: 'unchecked' });
            else setNow({ kind: 'ok', task, detail: r.detail });
        }).catch(() => { if (alive) setNow({ kind: 'missing' }); });
        return () => { alive = false; };
    }, [message.newVersionId, message.taskKey]);
    return now;
}

/** One side of the change: the work's name, when, and its doses - the dose rules of the hero card (a dose of an unchecked version is never shown as a number). */
const Side: React.FC<{ label: string; testId: string; task: DayCardTask; detail: DayCardsDetail; words: DayCardWords; tone: string }> = ({ label, testId, task, detail, words, tone }) => {
    const doses = doseLines(task.task);
    const hidden = detail.kind === 'reference' && !(detail.check.isChecked && task.doseChecked);
    return (
        <div className={`rounded-2xl px-3 py-2 ${tone}`} data-testid={testId}>
            <p className="m-0 text-[13px] font-extrabold uppercase tracking-wide text-stone-600">{label}</p>
            <p className="m-0 text-[20px] font-black leading-tight text-stone-900">{task.task.name}</p>
            <p className="m-0 text-[14px] font-bold text-stone-600">{timingText(task, words)}</p>
            {doses.map((d, i) => (
                <p key={`${d.name ?? 'dose'}-${i}`} className="m-0 mt-1 text-[16px] font-bold leading-snug text-stone-900">
                    {d.name ? `${d.name}: ` : ''}{hidden ? words.doseAfterCheck : d.text ? `${d.text}${d.perWhat ? ` / ${d.perWhat}` : ''}` : words.doseHidden}
                </p>
            ))}
        </div>
    );
};

const DECISION_OF_KIND = { accepted: 'accept', kept_old: 'keep_old', taken_back: 'take_back' } as const;

const ChangeButtons: React.FC<{ message: OwnerMessage; voice: OwnerVoiceProps; cropCycleId: string; canAccept: boolean; words: OwnerVoiceWords }> = ({ message, voice, cropCycleId, canAccept, words }) => {
    const standing = standingOf(voice.view, voice.host.plotId, cropCycleId, message.id);
    const mine = useTakeState(cropCycleId, message.taskKey);
    const [busy, setBusy] = useState(false);
    if (standing.queued || mine === null) return null;
    const send = async (d: OwnerDecision) => {
        if (busy) return;
        setBusy(true);
        try { await OwnerVoiceCommands.decide({ farmId: voice.host.farmId, plotId: voice.host.plotId, cropCycleId }, message.id, d); nudge(); } finally { setBusy(false); }
    };
    // The work is in my schedule (taken, or waiting to be): accept changes it. Otherwise it is only followed: accept takes the NEW one into my schedule.
    const inMine = mine?.kind === 'taken' || mine?.kind === 'queued';
    const btn = 'min-h-[52px] rounded-2xl px-4 text-[18px] font-black';
    return (
        <div className="flex flex-col gap-2">
            {standing.kind === 'accepted' ? (
                <button type="button" disabled={busy} onClick={() => { void send('take_back'); }} data-testid="change-take-back" className={`${btn} border-2 border-rose-700 bg-white text-rose-800`}>{words.takeBack}</button>
            ) : (
                <>
                    {canAccept && <button type="button" disabled={busy} onClick={() => { void send('accept'); }} data-testid="change-accept" className={`${btn} bg-emerald-800 text-white`}>{inMine ? words.accept : words.acceptTakeNew}</button>}
                    {standing.kind !== 'kept_old' && <button type="button" disabled={busy} onClick={() => { void send('keep_old'); }} data-testid="change-keep-old" className={`${btn} border-2 border-stone-300 bg-white text-stone-900`}>{words.keepOld}</button>}
                </>
            )}
        </div>
    );
};

/** A change: its own card, with "आधी" and "आता", then accept / keep the old one (after an accept, take it back). */
export const OwnerChangeBody: React.FC<{ message: OwnerMessage; task: DayCardTask; detail: DayCardsDetail; voice: OwnerVoiceProps; dayWords: DayCardWords }> = ({ message, task, detail, voice, dayWords }) => {
    const words = useWords();
    const now = useNow(message);
    const { host, view } = voice;
    const standing = standingOf(view, host.plotId, host.cropCycleId, message.id);
    const statusLine = standing.kind === 'none' ? null : standing.queued ? words.queuedLine(DECISION_OF_KIND[standing.kind]) : words.standing[standing.kind];
    const decider = host.mayDecide && host.cropCycleId !== null;
    return (
        <div className="flex flex-1 flex-col gap-3" data-testid={`change-card-${message.id}`}>
            <p className="m-0 text-[13px] font-extrabold text-orange-900">{words.changeChip} · {words.from}</p>
            <MessagePlay message={message} voice={voice} words={words} testId={`change-play-${message.id}`} notFetchedTestId={`change-not-fetched-${message.id}`} />
            <Side label={words.before} testId="change-before" task={task} detail={detail} words={dayWords} tone="bg-stone-100" />
            {now.kind === 'ok' && <Side label={words.now} testId="change-now" task={now.task} detail={now.detail} words={dayWords} tone="bg-emerald-50" />}
            {now.kind === 'missing' && <p className="m-0 rounded-2xl bg-amber-50 px-3 py-2 text-[15px] font-bold leading-snug text-amber-900" data-testid="change-now-missing">{words.nowMissing}</p>}
            {now.kind === 'unchecked' && <p className="m-0 rounded-2xl bg-amber-50 px-3 py-2 text-[15px] font-bold leading-snug text-amber-900" data-testid="change-now-unchecked">{words.nowUnchecked}</p>}
            <p className="m-0 text-[14px] font-semibold leading-snug text-stone-600">{words.changesNothing}</p>
            {statusLine && <p className="m-0 rounded-2xl bg-sky-50 px-3 py-2 text-[16px] font-extrabold leading-snug text-sky-900" data-testid="change-status" role="status">{statusLine}</p>}
            {decider && host.cropCycleId
                ? <ChangeButtons message={message} voice={voice} cropCycleId={host.cropCycleId} canAccept={now.kind === 'ok'} words={words} />
                : <p className="m-0 text-[14px] font-bold leading-snug text-stone-700" data-testid="change-only-owner">{words.onlyOwnerDecides}</p>}
        </div>
    );
};

// ---- the look card -----------------------------------------------------------------------------------------------------------------------------------------------------

/** A look and tell: its question clip, exactly two answers in the owner's words, and after the answer the owner's follow-up clip. */
export const OwnerLookBody: React.FC<{ message: OwnerMessage; task: DayCardTask; voice: OwnerVoiceProps }> = ({ message, task, voice }) => {
    const words = useWords();
    const { host, view } = voice;
    const [busy, setBusy] = useState(false);
    // Design: "the owner's follow-up plays after the answer" - it starts by itself right after THIS answer (not when the card is opened again later).
    const [justAnswered, setJustAnswered] = useState(false);
    const answered = answerOf(view, host.plotId, message.id);
    const decider = host.mayDecide && host.cropCycleId !== null;
    const answerWords = { first: message.answerFirst ?? '', second: message.answerSecond ?? '' };
    const followId = answered.answer === 'first' ? message.followUpFirstClipId : answered.answer === 'second' ? message.followUpSecondClipId : null;
    const send = async (a: 'first' | 'second') => {
        if (busy || !host.cropCycleId) return;
        setBusy(true);
        try {
            await OwnerVoiceCommands.answer({ farmId: host.farmId, plotId: host.plotId, cropCycleId: host.cropCycleId }, message.id, a);
            setJustAnswered(true);
            nudge();
        } finally { setBusy(false); }
    };
    return (
        <div className="flex flex-1 flex-col gap-3" data-testid={`look-card-${message.id}`}>
            <p className="m-0 text-[13px] font-extrabold text-orange-900">{words.lookChip} · {words.from}</p>
            <p className="m-0 text-[22px] font-black leading-tight text-stone-900">{task.task.name}</p>
            <MessagePlay message={message} voice={voice} words={words} testId={`look-play-${message.id}`} notFetchedTestId={`look-not-fetched-${message.id}`} />
            {answered.answer === null && decider && (
                <div className="mt-auto flex flex-col gap-2">
                    <button type="button" disabled={busy} onClick={() => { void send('first'); }} data-testid="look-answer-first" className="min-h-[56px] rounded-2xl bg-emerald-800 px-4 text-[20px] font-black text-white">{answerWords.first}</button>
                    <button type="button" disabled={busy} onClick={() => { void send('second'); }} data-testid="look-answer-second" className="min-h-[56px] rounded-2xl border-2 border-stone-300 bg-white px-4 text-[20px] font-black text-stone-900">{answerWords.second}</button>
                </div>
            )}
            {answered.answer === null && !decider && (
                <div className="space-y-1" data-testid="look-answers-read-only">
                    <p className="m-0 rounded-2xl bg-stone-100 px-3 py-2 text-[17px] font-bold text-stone-800">{answerWords.first}</p>
                    <p className="m-0 rounded-2xl bg-stone-100 px-3 py-2 text-[17px] font-bold text-stone-800">{answerWords.second}</p>
                </div>
            )}
            {answered.answer !== null && (
                <div className="space-y-2">
                    <p className="m-0 rounded-2xl bg-emerald-50 px-3 py-2 text-[18px] font-extrabold text-emerald-900" data-testid="look-answered">{words.youSaid}: {answerWords[answered.answer]}</p>
                    {answered.queued && <p className="m-0 text-[14px] font-bold text-sky-900" data-testid="look-queued" role="status">{words.answerQueuedLine}</p>}
                    {followId && (
                        <div className="space-y-1" data-testid={`look-followup-${answered.answer}`}>
                            <p className="m-0 text-[13px] font-extrabold text-orange-900">{words.followUp}</p>
                            <OwnerClipPlay clipId={followId} kept={view.keptClips.has(followId)} words={words} autoStart={justAnswered}
                                testId={`look-followup-play-${answered.answer}`} notFetchedTestId={`look-followup-not-fetched-${answered.answer}`} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
