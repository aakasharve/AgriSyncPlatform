/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * निरीक्षणं व नोंदी — the chosen day's notes (the old Observations panel), each marked अडचण / आठवण /
 * निरीक्षण / सल्ला / नोंद, with the time, the plot and who told it when the record says so; how serious it
 * is and its tags, as before. A long note opens in full on a tap. Every Marathi string is PROPOSED.
 *
 * Lane RF (founder 2026-10-30): each note says who told it the result screen's way ("तुम्ही" for the person holding
 * this phone), when, whether its record is confirmed (the page's ONE wording), links to the recording it came from
 * (its glance), and offers ▶ where it may be offered (`listenModel.ts`) — never a play button that cannot play.
 */
import React, { useState } from 'react';
import { TimePill, WhoChip } from '../../logs/components/voiceResult/DayParts';
import type { DayRecording } from '../day/dayRecordings';
import { ListenControl, StatusChip, useReflectCopy } from '../day/RecordingParts';
import type { DayListen } from '../day/useDayListen';
import type { NoteItem } from './notesModel';

const KIND_TONE: Record<NoteItem['kind'], string> = {
    issue: 'bg-rose-100 text-rose-800',
    reminder: 'bg-sky-100 text-sky-800',
    observation: 'bg-blue-100 text-blue-800',
    tip: 'bg-emerald-100 text-emerald-800',
    unknown: 'bg-stone-100 text-stone-700',
};

export interface NoteSources {
    /** The day's recording a note's record belongs to. */
    recordingOf: (logId: string) => DayRecording | undefined;
    listen: DayListen;
    onOpen: (rec: DayRecording) => void;
}

export const NotesList: React.FC<{ notes: readonly NoteItem[]; sources?: NoteSources }> = ({ notes, sources }) => {
    const copy = useReflectCopy();
    const [openIds, setOpenIds] = useState<string[]>([]);
    if (!notes.length) {
        return <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14px] font-bold text-stone-500" data-testid="notes-empty">या दिवशी कोणतीही नोंद नाही</p>;
    }
    const toggle = (id: string) => setOpenIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
    return (
        <div className="space-y-2" data-testid="notes-list">
            {notes.map(n => {
                const open = openIds.includes(n.id);
                // The time and who get their own chips (the result screen's); the plot (and a name the page could
                // not put in a chip) stay in the line.
                const meta = [n.who ? '' : n.time, n.place, n.who ? '' : n.by].filter(Boolean).join(' · ');
                const rec = sources?.recordingOf(n.logId);
                return (
                    <div key={n.id} className="rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid={`note-${n.id}`}>
                        <button type="button" onClick={() => toggle(n.id)} aria-expanded={open} data-testid={`note-${n.id}-toggle`} className="block w-full text-left">
                            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-stone-500">
                                <span className={`rounded-full px-2 py-0.5 font-extrabold ${KIND_TONE[n.kind]}`}>{n.kindLabel}</span>
                                {n.severityLabel && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-extrabold text-amber-800">{n.severityLabel}</span>}
                                {n.who && <TimePill label={n.time} />}
                                {n.who && <WhoChip who={n.who} testId={`note-${n.id}-who`} />}
                                <StatusChip confirmed={n.confirmed} testId={`note-${n.id}-state`} />
                                {meta}
                            </span>
                            <span className={`mt-1.5 block text-[15px] font-bold leading-snug text-stone-800 ${open ? '' : 'line-clamp-2'}`}>{n.text}</span>
                            {n.tags.length > 0 && (
                                <span className="mt-1.5 flex flex-wrap gap-1">
                                    {n.tags.map(t => <span key={t} className="rounded-full bg-stone-100 px-2 py-0.5 text-[12px] font-bold text-stone-600">{t}</span>)}
                                </span>
                            )}
                        </button>
                        {rec && sources && (
                            <>
                                <ListenControl rec={rec} listen={sources.listen} testId={`note-${n.id}-play`} />
                                <button type="button" onClick={() => sources.onOpen(rec)} data-testid={`note-${n.id}-source`}
                                    className="mt-2 inline-flex min-h-[40px] items-center rounded-full border border-violet-200 bg-violet-50 px-3 text-[13px] font-extrabold text-violet-800">
                                    {copy.noteSource} ›
                                </button>
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
