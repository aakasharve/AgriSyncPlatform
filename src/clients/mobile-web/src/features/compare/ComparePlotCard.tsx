/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1) — ONE card per plot on तुलना, in the
 * founder-approved look (PLR-D9 T7, preview `app/ComparePage.tsx`): "x पैकी y कामं झाली" for the last 7 days,
 * a colour bar, at most three "अजून करायचं" rows each with "झालं, सांगा" (opens the real log flow for THIS
 * plot), otherwise "सगळं वेळेवर — छान!". Older open work is only counted. Never "late" / "Do this now".
 *
 * Below the week, "पूर्ण तपशील" folds open every part the old page had for a plot (`CompareDetails`).
 * Strings marked PROPOSED (Marathi) are new; the rest are the preview's approved words.
 */
import React from 'react';
import { Check, ChevronDown, ChevronUp, Mic, CalendarDays } from 'lucide-react';
import { GlassCard, Tap } from '../../shared/components/ui/placeUi';
import type { ComparePlotRow } from './compareRows';
import { weekBarTone, WEEK_DAYS } from './compareWeek';

const BAR: Record<ReturnType<typeof weekBarTone>, string> = {
    green: 'from-emerald-500 to-emerald-700',
    amber: 'from-amber-400 to-amber-600',
    rose: 'from-rose-400 to-rose-600',
};

interface Props {
    row: ComparePlotRow;
    /** Opens the real log flow for this plot (crop + plot picked, voice ready). */
    onTell?: (cropId: string, plotId: string) => void;
    /** The real शेड्यूल page. */
    onOpenSchedule?: () => void;
    detailsOpen: boolean;
    onToggleDetails: () => void;
    children?: React.ReactNode;
}

export const ComparePlotCard: React.FC<Props> = ({ row, onTell, onOpenSchedule, detailsOpen, onToggleDetails, children }) => {
    const { crop, plot, hasSchedule, week } = row;
    const id = plot.id;
    return (
        <GlassCard testId={`compare-plot-${id}`}>
            <div className="flex items-center gap-3">
                <span className={`h-11 w-11 shrink-0 rounded-xl ${crop.color || 'bg-emerald-500'}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    {/* The crop by name too (the old page's "Crop: X | Plot: Y"), so two crops' plots are told apart. */}
                    <p className="m-0 truncate text-[17px] font-extrabold text-stone-900">
                        {plot.name}
                        {crop.name && <span className="text-[14px] font-bold text-stone-500" data-testid={`compare-crop-${id}`}> · {crop.name}</span>}
                    </p>
                    {hasSchedule && (
                        <p className="m-0 truncate text-[13px] font-semibold text-stone-600" data-testid={`compare-week-line-${id}`}>
                            {!week
                                // PROPOSED (Marathi) — the comparison could not be worked out: say so, never "nothing was due" (P4).
                                ? 'माहिती नाही'
                                : week.expected > 0
                                    ? `${week.expected} पैकी ${week.done} कामं झाली`
                                    // PROPOSED (Marathi)
                                    : `मागच्या ${WEEK_DAYS} दिवसांत शेड्यूलमध्ये काम नव्हतं`}
                        </p>
                    )}
                </div>
                {hasSchedule && (
                    <p className="m-0 text-[22px] font-extrabold text-stone-900" data-testid={`compare-percent-${id}`}>
                        {week?.percent == null ? '—' : `${week.percent}%`}
                    </p>
                )}
            </div>

            {!hasSchedule && (
                <div className="mt-2.5 space-y-2" data-testid={`compare-noschedule-${id}`}>
                    {/* PROPOSED (Marathi) — was "No Schedule Adopted / Compare needs an active schedule." */}
                    <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[14px] font-bold text-amber-900 ring-1 ring-amber-200">
                        या प्लॉटला अजून शेड्यूल लावलेलं नाही. शेड्यूल लावलं की इथे रोजच्या कामाशी तुलना दिसेल.
                    </p>
                    {onOpenSchedule && (
                        <Tap onClick={onOpenSchedule} data-testid={`compare-adopt-${id}`}
                            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-full border-2 border-emerald-600 bg-white text-[15px] font-extrabold text-emerald-800">
                            {/* PROPOSED (Marathi) */}
                            <CalendarDays size={18} aria-hidden="true" />शेड्यूल लावा
                        </Tap>
                    )}
                </div>
            )}

            {hasSchedule && !row.laidOut && row.summary && (
                // PROPOSED (Marathi) — the crop has a schedule but this plot has no schedule start, so the engine
                // laid no work on its days: say why there is no number, never "nothing was due" (I14-V2-03, P4).
                <p className="m-0 mt-2 rounded-xl bg-stone-50 px-3 py-2 text-[13.5px] font-bold text-stone-700 ring-1 ring-stone-200" data-testid={`compare-nostart-${id}`}>
                    या प्लॉटवर शेड्यूल कोणत्या दिवसापासून सुरू झालं ते नोंदलेलं नाही, म्हणून तुलना करता येत नाही.
                </p>
            )}

            {hasSchedule && week && week.percent != null && (
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-200" data-testid={`compare-bar-${id}`}>
                    <div className={`h-full rounded-full bg-gradient-to-r ${BAR[weekBarTone(week.percent)]}`} style={{ width: `${week.percent}%` }} />
                </div>
            )}

            {hasSchedule && week && week.todo.length > 0 && (
                <div className="mt-2.5 space-y-1.5" data-testid={`compare-todo-${id}`}>
                    <p className="m-0 text-[13.5px] font-extrabold text-stone-800">अजून करायचं</p>
                    {week.todo.map((t, i) => (
                        <div key={t.label} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
                            <span className="min-w-0 text-[14px] font-bold text-amber-900">
                                {/* PROPOSED (Marathi) — the count when the same work is open more than once */}
                                {t.count > 1 ? `${t.label} (${t.count} वेळा)` : t.label}
                            </span>
                            {onTell && (
                                <Tap onClick={() => onTell(crop.id, plot.id)} data-testid={`compare-tell-${id}-${i}`}
                                    className="flex min-h-[38px] shrink-0 items-center gap-1 rounded-full bg-white px-3 text-[13px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">
                                    <Mic size={15} aria-hidden="true" />झालं, सांगा
                                </Tap>
                            )}
                        </div>
                    ))}
                    {week.moreTodo > 0 && (
                        // PROPOSED (Marathi)
                        <p className="m-0 px-1 text-[13px] font-semibold text-stone-600" data-testid={`compare-more-${id}`}>आणखी {week.moreTodo} कामं — पूर्ण शेड्यूलमध्ये दिसतील</p>
                    )}
                </div>
            )}

            {hasSchedule && week && week.expected > 0 && week.todo.length === 0 && (
                <p className="m-0 mt-2.5 flex items-center gap-1.5 text-[14px] font-extrabold text-emerald-800" data-testid={`compare-ontime-${id}`}>
                    <Check size={17} aria-hidden="true" />
                    {week.olderOpen > 0
                        // PROPOSED (Marathi) — the 7 days are done but older work is still unrecorded (counted just
                        // below): "everything on time" would contradict that line (I14-V2F-04a).
                        ? 'या आठवड्याचं सगळं झालं — छान!'
                        : 'सगळं वेळेवर — छान!'}
                </p>
            )}

            {hasSchedule && week && week.olderOpen > 0 && (
                // PROPOSED (Marathi) — older open work is counted, never listed (PLR-D9 T7).
                <p className="m-0 mt-2 px-1 text-[13px] font-semibold text-stone-600" data-testid={`compare-older-${id}`}>
                    त्याआधीची {week.olderOpen} कामं नोंदलेली नाहीत — पूर्ण तपशीलात पाहा
                </p>
            )}

            {hasSchedule && row.summary && (
                <>
                    <Tap onClick={onToggleDetails} aria-expanded={detailsOpen} data-testid={`compare-details-toggle-${id}`}
                        className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-stone-100 text-[14px] font-extrabold text-stone-700">
                        {/* PROPOSED (Marathi) — a plot with no schedule start opens its spend only (`CompareDetails`,
                            I14-V3-03): there is no plan to detail, so the button does not promise "full details". */}
                        {detailsOpen
                            ? <><ChevronUp size={18} aria-hidden="true" />तपशील लपवा</>
                            : <><ChevronDown size={18} aria-hidden="true" />{row.laidOut ? 'पूर्ण तपशील पाहा' : 'खर्च पाहा'}</>}
                    </Tap>
                    {detailsOpen && children}
                </>
            )}
        </GlassCard>
    );
};
