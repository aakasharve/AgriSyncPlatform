/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriVahi — the हजेरी वही screen with its history (spec: plr-d10-redesign-real-integration-
 * 2026-10-25, I23 / N5; founder D-16, 2026-10-26): "Provide previous/next navigation for week and
 * month views, show the exact date range and include an obvious 'आज' return … Opening an older
 * period is read-only by default. Tapping a cell opens its recorded details … Future attendance must
 * not be recorded."
 *
 *  - ‹ › turn back / forward one week or one month (the आठवडा · महिना switch). The SERVER owns every
 *    boundary (`?window=week|month&anchor=yyyy-MM-dd`, `LabourTimeWindow.Resolve`): ‹ asks for the
 *    day before the range it last sent, › for the day after (`vahiPeriod.ts`). A past period is
 *    whole (a week is Monday–Sunday); the current one ends today.
 *  - The heading is the exact range the server filtered on, and says when it ends today.
 *  - › is visibly disabled once the range reaches today: there is no future page (no future हजेरी).
 *  - "आज" returns to the current period from anywhere.
 *  - READ-ONLY by construction: this screen has no write path. A tap on a cell opens that day's
 *    detail (who, what was said, how it was counted) and nothing else; correcting an old day is a
 *    separate, deliberate action the founder will rule on (D-16 #2), not built here.
 *  - A page that cannot be fetched says so ("माहिती आणता आली नाही") with the existing retry; it never
 *    shows another period's grid under this period's heading. The current period falls back to the
 *    feature's own read-out (which already carries the offline register), heading named by its dates.
 *  - No farm (the bare `?preview=labour` mount) = no server to ask: the grid as given, no paging.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { LabourData, LedgerRow } from '../labour.types';
import type { LabourWindow } from '../labourWindow';
import HajeriLedger from './HajeriLedger';
import { LoadErrorBanner, LoadingState } from './LabourUiKit';
import { fetchLabourData } from '../data/labourClient';
import { getLocalAttendanceMarks, getLocalAttendanceNameHints } from '../data/attendanceLocal';
import { overlayLocalAttendance } from '../attendanceOverlay';
import {
    VAHI_UNIT_LABELS, isCurrentPeriod, nextPeriodAnchor, openingVahiPeriod, previousPeriodAnchor, vahiHeading,
    type VahiPeriodState, type VahiUnit,
} from '../vahiPeriod';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { hapticFeedback } from '../../../shared/utils/haptics';

/** PROPOSED (Marathi) — screen-reader names of the two arrows. */
const PREV_LABEL = 'आधीचे दिवस';
const NEXT_LABEL = 'पुढचे दिवस';
/** APPROVED — the labour window word for today (labourWindow.ts). */
const TODAY_LABEL = 'आज';

interface Props {
    /** The feature's own read-out (useLabourState) — the current period's fallback and the preview grid. */
    data: LabourData;
    /**
     * Optional CONTROLLED page: the feature keeps it so a background refresh (which remounts this
     * screen) does not throw the farmer back to today while he is reading an old week.
     */
    period?: VahiPeriodState;
    onPeriodChange?: (next: VahiPeriodState) => void;
    /** The window `data` answers for: reused as-is when it already IS the current page. */
    mainWindow: LabourWindow;
    /** No farm = no server to page (preview). */
    farmId?: string;
    /** Injectable for tests; the device's farm-day otherwise. */
    todayKey?: string;
    onOpenCell: (row: LedgerRow, dayIndex: number, dayIso: string) => void;
    onToast: (m: string) => void;
}

/** A fetched page remembers which request it answers, so a page never shows under another's heading. */
type PageState =
    | { status: 'idle' }
    | { status: 'ready'; key: string; data: LabourData }
    | { status: 'error'; key: string };

async function loadPage(farmId: string, unit: VahiUnit, anchor: string | null): Promise<LabourData> {
    const real = await fetchLabourData(farmId, unit, anchor ?? undefined);
    try {
        // P10 — a mark still on this phone (queued, not yet acknowledged) shows weaker on its day.
        const marks = await getLocalAttendanceMarks(farmId);
        if (marks.length === 0) return real;
        return overlayLocalAttendance(real, marks, await getLocalAttendanceNameHints(farmId, marks));
    } catch {
        return real; // storage unavailable: the server's page alone, never a crash
    }
}

const HajeriVahi: React.FC<Props> = ({ data, period, onPeriodChange, mainWindow, farmId, todayKey, onOpenCell, onToast }) => {
    const today = todayKey ?? getDateKey();
    const [ownPeriod, setOwnPeriod] = useState<VahiPeriodState>(() => openingVahiPeriod(mainWindow));
    const { unit, anchor } = period ?? ownPeriod;
    const setPeriod = useCallback((next: VahiPeriodState) => {
        if (onPeriodChange) onPeriodChange(next); else setOwnPeriod(next);
    }, [onPeriodChange]);
    const [retry, setRetry] = useState(0);
    const [page, setPage] = useState<PageState>({ status: 'idle' });

    // The current period in the window the feature already holds needs no second request.
    const reuseMain = !farmId || (anchor === null && unit === mainWindow);

    const requestKey = `${unit}|${anchor ?? ''}|${retry}`;

    // `data` is a dependency on purpose: when the feature's read-out is refreshed in place (a sync settled,
    // a mark was saved or refused), this page is asked again too. The page on screen stays until the new
    // answer lands, and a failed re-ask of a page already shown keeps that page.
    useEffect(() => {
        if (reuseMain || !farmId) return;
        let live = true;
        loadPage(farmId, unit, anchor)
            .then((d) => { if (live) setPage({ status: 'ready', key: requestKey, data: d }); })
            .catch(() => {
                if (live) setPage((p) => (p.status === 'ready' && p.key === requestKey ? p : { status: 'error', key: requestKey }));
            });
        return () => { live = false; };
    }, [farmId, unit, anchor, reuseMain, requestKey, data]);

    // Until THIS request answers, the screen is loading — never the previous page, never an error.
    const answered = !reuseMain && page.status !== 'idle' && page.key === requestKey ? page : null;

    // What the grid shows: the fetched page; the feature's read-out for the current period (also when
    // its fetch failed — that read-out already carries the cached / offline register); nothing for a
    // past page that could not be fetched.
    const shown: LabourData | null = reuseMain ? data
        : answered?.status === 'ready' ? answered.data
            : answered?.status === 'error' && anchor === null ? data
                : null;

    const windowFrom = shown?.dashboard.windowFrom ?? '';
    const windowTo = shown?.dashboard.windowTo ?? '';
    const prev = shown ? previousPeriodAnchor(windowFrom) : null;
    const next = shown ? nextPeriodAnchor(windowTo, today) : undefined;
    const atToday = anchor === null || (shown !== null && isCurrentPeriod(windowTo, today));
    const heading = shown ? (vahiHeading(shown, today) || (!windowFrom && !windowTo ? 'सर्व दिवस' : '')) : '';

    const go = useCallback((nextAnchor: string | null) => {
        hapticFeedback.light();
        setPeriod({ unit, anchor: nextAnchor });
    }, [setPeriod, unit]);

    const openCell = (row: LedgerRow, dayIndex: number) => {
        if (!shown) return;
        onOpenCell(row, dayIndex, shown.ledger.days[dayIndex] ?? '');
    };

    if (!farmId) {
        return (
            <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
                <HajeriLedger data={data} onToast={onToast} onOpenCell={openCell} embedded />
            </div>
        );
    }

    const arrow = 'flex h-14 w-14 flex-none items-center justify-center rounded-2xl border text-[28px] font-black leading-none transition-transform active:scale-95';

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2" data-testid="hajeri-vahi">
            <div data-testid="vahi-paging" className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_6px_20px_-10px_rgba(20,40,30,0.28)]">
                <div role="tablist" aria-orientation="horizontal" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-50 p-1">
                    {(['week', 'month'] as const).map((u) => (
                        <button key={u} type="button" role="tab" aria-selected={unit === u} data-testid={`vahi-unit-${u}`}
                            onClick={() => { if (unit === u) return; hapticFeedback.light(); setPeriod({ unit: u, anchor: null }); }}
                            className={`min-h-[48px] rounded-lg text-[17px] font-extrabold ${unit === u ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>
                            {VAHI_UNIT_LABELS[u]}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" data-testid="vahi-prev" aria-label={PREV_LABEL} disabled={prev === null}
                        onClick={() => { if (prev !== null) go(prev); }}
                        className={`${arrow} border-slate-200 bg-white text-slate-700 disabled:opacity-40`}>‹</button>
                    <span data-testid="vahi-heading" className="min-w-0 flex-1 text-center text-[17px] font-extrabold leading-snug text-slate-800">
                        {heading}
                    </span>
                    {/* No future page: visibly disabled once the range reaches today (D-16, P5). */}
                    <button type="button" data-testid="vahi-next" aria-label={NEXT_LABEL} disabled={next === undefined}
                        onClick={() => { if (next !== undefined) go(next); }}
                        className={`${arrow} border-slate-200 bg-white text-slate-700 disabled:opacity-40`}>›</button>
                </div>
                {!atToday && (
                    <button type="button" data-testid="vahi-today" onClick={() => go(null)}
                        className="min-h-[48px] rounded-xl bg-emerald-600 text-[17px] font-extrabold text-white active:scale-[0.99]">
                        {TODAY_LABEL}
                    </button>
                )}
            </div>

            {!reuseMain && answered === null ? (
                <LoadingState compact />
            ) : shown === null ? (
                <LoadErrorBanner compact onRetry={() => setRetry((n) => n + 1)} />
            ) : (
                <HajeriLedger data={shown} onToast={onToast} onOpenCell={openCell} embedded hideHeading />
            )}
        </div>
    );
};

export default HajeriVahi;
