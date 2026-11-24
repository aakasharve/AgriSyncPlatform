// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; owner messages are slice 12b) - the ONE line for a new owner voice on the Schedule tab.
// The slot is clean and tested and shows NOTHING until there is an unheard voice. There is no data source yet: the page gives an empty list. It never invents one.
import React from 'react';

export interface OwnerVoice { id: string; title: string; fromName: string; heard: boolean }

export const OwnerVoiceSlot: React.FC<{ voices: readonly OwnerVoice[]; onPlay?: (id: string) => void; playLabel?: string }> = ({ voices, onPlay, playLabel = 'ऐका' }) => {
    const next = voices.find(v => !v.heard);
    if (!next) return null;
    return (
        <div className="flex items-center gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 px-3 py-2" data-testid="owner-voice-line">
            <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[16px] font-black text-stone-900">{next.title}</p>
                <p className="m-0 truncate text-[13px] font-bold text-stone-600">{next.fromName}</p>
            </div>
            {onPlay && (
                <button type="button" onClick={() => onPlay(next.id)} data-testid="owner-voice-play" className="min-h-[48px] rounded-full bg-blue-700 px-4 text-[16px] font-extrabold text-white">{playLabel}</button>
            )}
        </div>
    );
};
