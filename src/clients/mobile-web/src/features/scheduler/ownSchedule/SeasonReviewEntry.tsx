/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; SM-10; P8, P10) - the door of the season-end review inside "माझं शेड्यूल":
 * a card shown ONLY when the plot has a newer season than the one its own works belong to and the pair was not answered, to a seat that may plan (the owner or a holder of
 * PlanWork: the server's own gate; a worker is never given `planning` and never sees it). Once the answers are stored (on the server, or waiting in the outbox) the card says
 * so and the review never pops again; the answers stay readable.
 */
import React, { useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { Tap } from '../../../shared/components/ui/placeUi';
import { usePlannedWork } from '../../plannedWork/data/usePlannedWork';
import { getLocalOwnSchedule } from './ownScheduleLocal';
import type { OwnLanguage } from './ownScheduleWords';
import type { OwnWorkPlace } from './ownWorkPlace';
import { SeasonReview, SeasonReviewRead } from './SeasonReview';
import { useSeasonReview } from './seasonReviewLocal';
import { SEASON_REVIEW_WORDS } from './seasonReviewWords';

export const SeasonReviewEntry: React.FC<{ place: OwnWorkPlace; language: OwnLanguage }> = ({ place, language }) => {
    const words = SEASON_REVIEW_WORDS[language];
    const { items: plans } = usePlannedWork(place.farmId);
    const state = useSeasonReview(place.farmId, place.plotId, place.cropCycleId, plans);
    const [open, setOpen] = useState(false);
    const [names, setNames] = useState<Record<string, string>>({});
    const from = state && state.kind !== 'none' ? state.fromCropCycleId : null;
    useEffect(() => {
        if (!from) return;
        let alive = true;
        getLocalOwnSchedule(getDatabase(), from)
            .then(works => { if (alive) setNames(Object.fromEntries(works.map(w => [w.taskKey, w.task.name]))); })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [from]);
    if (!state || state.kind === 'none') return null;

    const line = state.kind === 'ask' ? words.entrySub : state.kind === 'queued' ? words.entryQueued : words.entryAnswered;
    return (
        <section className="space-y-1.5 rounded-3xl border-2 border-emerald-600 bg-emerald-50 p-3.5" data-testid="season-entry" data-state={state.kind}>
            <div className="flex items-center gap-2">
                <CalendarCheck size={22} aria-hidden="true" className="text-emerald-800" />
                <h4 className="m-0 text-[18px] font-extrabold text-emerald-950">{words.entryTitle}</h4>
            </div>
            <p className="m-0 text-[14px] font-bold text-stone-800">{line}</p>
            {state.kind !== 'queued' && (
                <Tap onClick={() => setOpen(true)} data-testid="season-entry-open"
                    className="min-h-[52px] w-full rounded-2xl bg-emerald-700 px-3 text-[16px] font-extrabold text-white">
                    {state.kind === 'ask' ? words.entryOpen : words.entryRead}
                </Tap>
            )}
            {open && state.kind === 'ask' && (
                <SeasonReview farmId={place.farmId} plotId={place.plotId} plotName={place.plotName} fromCropCycleId={state.fromCropCycleId}
                    toCropCycleId={place.cropCycleId} model={state.model} originNames={state.originNames} language={language}
                    onBack={() => setOpen(false)} onFinished={() => setOpen(false)} />
            )}
            {open && state.kind === 'answered' && <SeasonReviewRead rows={state.rows} names={names} language={language} onBack={() => setOpen(false)} />}
        </section>
    );
};

export default SeasonReviewEntry;
