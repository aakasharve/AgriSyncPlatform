/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, round 3; version 7) - "तुम्ही पाळत असलेली शेड्यूल" with the 3 + 1 dots at the right, then a 2 x 2 grid of FOUR tiles:
 * संस्था, तज्ज्ञ, कृषी सल्लागार, तुमचं स्वतःचं. Each filled tile has the app's own picture for who made it (never an institution's logo: SM-17), its title, the maker under it and a
 * "स्रोत ..." line; the main one carries "मुख्य" and a green border; a tile with unheard owner messages carries "N आवाज" (slice 12b fills it; hidden at 0). An empty tile is still drawn and
 * says what it is for (show the rule, never vanish); tapping it is the same door the old section had (follow one more / make my own). Tapping a filled tile chooses the schedule the
 * profile card below shows. It replaces the old collapsible section on this tab; that section (with "leave") stays one tap away at the end of the page.
 */
import React from 'react';
import { ClipboardList, Landmark, Plus, Sprout, User } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { FollowedPlace } from './resolveSchedule';
import { mrNum } from './scheduleCopy';
import { scheduleNameIn } from './scheduleNames';
import { Rail } from './ThreePlusOneSection';

type Kind = 'INSTITUTION' | 'EXPERT' | 'ADVISOR' | 'OWN';
const KINDS: readonly Kind[] = ['INSTITUTION', 'EXPERT', 'ADVISOR', 'OWN'];
const INTERNAL_AUTHORS = new Set(['ShramSafal Reference Data', 'System Fallback']);

export const TILE_WORDS = {
    mr: {
        heading: 'तुम्ही पाळत असलेली शेड्यूल', rail: 'तीन बाहेरची आणि एक स्वतःचं', main: 'मुख्य', source: 'स्रोत', voices: (n: number) => `${mrNum(n)} आवाज`, maker: 'श्रमसफल',
        title: { INSTITUTION: 'संस्था', EXPERT: 'तज्ज्ञ', ADVISOR: 'कृषी सल्लागार', OWN: 'तुमचं स्वतःचं' },
        empty: { INSTITUTION: 'संस्थेचं शेड्यूल इथे पाळता येईल', EXPERT: 'तज्ज्ञाचं शेड्यूल इथे पाळता येईल', ADVISOR: 'कृषी सल्लागाराचं शेड्यूल इथे पाळता येईल', OWN: 'तुमचं स्वतःचं शेड्यूल इथे येईल' },
        add: 'पाळा', make: 'बनवा', noSource: 'लिहिलेला नाही', own: 'तुम्ही', ownSource: 'माझ्या नोंदी',
    },
    en: {
        heading: 'Schedules you follow', rail: 'three from outside and one of your own', main: 'Main', source: 'Source', voices: (n: number) => `${n} voice`, maker: 'ShramSafal',
        title: { INSTITUTION: 'Institution', EXPERT: 'Expert', ADVISOR: 'Farm advisor', OWN: 'Your own' },
        empty: { INSTITUTION: "An institution's schedule can be followed here", EXPERT: "An expert's schedule can be followed here", ADVISOR: "A farm advisor's schedule can be followed here", OWN: 'Your own schedule will be here' },
        add: 'Follow', make: 'Make', noSource: 'not written', own: 'You', ownSource: 'My records',
    },
} as const;

const LOOK: Record<Kind, { bg: string; fg: string; Icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }> = {
    INSTITUTION: { bg: '#D1FAE5', fg: '#047857', Icon: Landmark },
    EXPERT: { bg: '#EDE9FE', fg: '#6D28D9', Icon: Sprout },
    ADVISOR: { bg: '#CFFAFE', fg: '#0E7490', Icon: ClipboardList },
    OWN: { bg: '#FEF3C7', fg: '#B45309', Icon: User },
};

/** Which tile each followed place sits in: his own place in the fourth; an outside place in the tile of its owner type, else the first free outside tile. Pure. */
export function placeTiles(followed: readonly FollowedPlace[]): Record<Kind, FollowedPlace | null> {
    const out: Record<Kind, FollowedPlace | null> = { INSTITUTION: null, EXPERT: null, ADVISOR: null, OWN: null };
    const loose: FollowedPlace[] = [];
    for (const p of followed) {
        if (p.origin === 'Own') { out.OWN = out.OWN ?? p; continue; }
        const t = p.template?.ownerType as string | undefined;
        if ((t === 'INSTITUTION' || t === 'EXPERT' || t === 'ADVISOR') && !out[t]) out[t] = p; else loose.push(p);
    }
    for (const p of loose) { const free = (['INSTITUTION', 'EXPERT', 'ADVISOR'] as const).find(k => !out[k]); if (free) out[free] = p; }
    return out;
}

export const ScheduleTiles: React.FC<{
    followed: readonly FollowedPlace[];
    selectedTemplateId: string | null;
    onSelect: (templateId: string) => void;
    onAdd?: () => void;
    mayMakeOwn?: boolean;
    onMakeOwn?: () => void;
    /** Unheard owner voices per schedule version (slice 12b). Nothing gives it yet: every tile then shows no count. */
    unheard?: Readonly<Record<string, number>>;
}> = ({ followed, selectedTemplateId, onSelect, onAdd, mayMakeOwn = false, onMakeOwn, unheard = {} }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const w = TILE_WORDS[language];
    const tiles = placeTiles(followed);
    const outside = followed.filter(p => p.origin !== 'Own');
    const own = followed.find(p => p.origin === 'Own');
    return (
        <section className="space-y-2 rounded-3xl border border-stone-200 bg-white p-3 shadow-sm" data-testid="schedule-tiles">
            <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 text-[19px] font-black leading-snug text-stone-900" data-testid="schedule-tiles-heading">{w.heading}</h3>
                <Rail outside={outside} own={own} label={w.rail} testId="schedule-tiles-rail" />
            </div>
            <div className="grid grid-cols-2 gap-2" data-testid="schedule-tiles-grid">
                {KINDS.map(kind => {
                    const place = tiles[kind];
                    const look = LOOK[kind];
                    const icon = <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: look.bg, color: look.fg }} aria-hidden="true">{React.createElement(look.Icon, { size: 24, 'aria-hidden': true })}</span>;
                    if (!place) {
                        const canOwn = kind === 'OWN' && mayMakeOwn && !!onMakeOwn;
                        const act = kind === 'OWN' ? (canOwn ? onMakeOwn : undefined) : onAdd;
                        return (
                            <button key={kind} type="button" disabled={!act} onClick={act} data-testid={`tile-empty-${kind}`}
                                className="flex min-h-[132px] flex-col items-start gap-1.5 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/70 p-2.5 text-left">
                                {icon}
                                <strong className="text-[16px] font-black leading-tight text-stone-900">{w.title[kind]}</strong>
                                <span className="text-[13px] font-bold leading-snug text-stone-600">{w.empty[kind]}</span>
                                {act && <span className="mt-auto inline-flex items-center gap-1 text-[14px] font-extrabold text-emerald-800"><Plus size={14} aria-hidden="true" />{kind === 'OWN' ? w.make : w.add}</span>}
                            </button>
                        );
                    }
                    const t = place.template;
                    const author = t?.createdBy?.trim();
                    const maker = kind === 'OWN' ? w.own : author && !INTERNAL_AUTHORS.has(author) ? author : w.maker;
                    const sourceText = kind === 'OWN' ? w.ownSource : t?.sourceLabel ?? w.noSource;
                    const voices = unheard[place.templateId] ?? 0;
                    const sel = place.templateId === selectedTemplateId;
                    return (
                        <button key={kind} type="button" onClick={() => onSelect(place.templateId)} aria-pressed={sel} data-testid={`tile-${kind}`} data-template={place.templateId} data-main={place.isMain ? 'true' : 'false'}
                            className={`relative flex min-h-[132px] flex-col gap-2 rounded-2xl border-2 p-2.5 pt-4 text-left ${place.isMain ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-white'} ${sel ? 'ring-2 ring-emerald-700' : ''}`}>
                            {voices > 0 && <span className="absolute -top-2 left-2 rounded-full bg-orange-600 px-2 py-0.5 text-[12px] font-extrabold text-white" data-testid={`tile-voices-${kind}`}>{w.voices(voices)}</span>}
                            {place.isMain && <span className="absolute -top-2 right-2 rounded-full bg-emerald-700 px-2 py-0.5 text-[12px] font-extrabold text-white" data-testid={`tile-main-${kind}`}>{w.main}</span>}
                            <span className="flex w-full items-center gap-2">
                                {icon}
                                <span className="min-w-0">
                                    <strong className="block text-[16px] font-black leading-tight text-stone-900">{w.title[kind]}</strong>
                                    <span className="block text-[13px] font-bold leading-snug text-stone-600" data-testid={`tile-maker-${kind}`}>{maker}</span>
                                </span>
                            </span>
                            <span className="mt-auto w-full rounded-lg bg-white/80 px-2 py-1 text-[13px] font-bold leading-snug text-stone-800" data-testid={`tile-source-${kind}`}>{w.source} {sourceText}</span>
                            {t && <span className="sr-only">{scheduleNameIn(t.name, language)}</span>}
                        </button>
                    );
                })}
            </div>
        </section>
    );
};
