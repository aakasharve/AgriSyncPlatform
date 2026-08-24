/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 8 — design doc §5.2, §5.3)
 *
 * RecordBar — the second of the home screen's two taps, pinned above the
 * bottom navigation so it never scrolls away.
 *
 *   Tap 1 = a plot (`CropSelector`).  Tap 2 = this bar.
 *
 * Grey and inert before a plot is chosen, saying what to do first
 * (`recordBarIdle` — "आधी प्लॉट निवडा"); emerald and active the moment one
 * is (`recordBarActive` — "बोला"). Both strings are founder-supplied and
 * live in `i18n/oversightTranslations.ts`; both are listed in
 * `PENDING_FOUNDER_STRINGS`, so they are read through
 * `resolveOversightString()` like every other oversight string — never off
 * `oversightTranslations.mr[...]` directly, which renders a blank label for
 * a key whose `mr` is still empty.
 *
 * WHY IT LIVES IN `AppContent.tsx`, NOT `mainView.tsx`
 * ------------------------------------------------------
 * `BottomNavigation` mounts in `AppContent.tsx`, and `<main>` — which is
 * where `mainView.tsx`'s output renders — is the element that scrolls. A bar
 * rendered inside `<main>` scrolls away by construction, which is the exact
 * defect this component exists to remove. It is therefore a SIBLING of
 * `<main>`, above `<nav>`, exactly like `BottomNavigation` itself.
 *
 * That placement also settles the recording-guard question (`§P-I`, and
 * `shared/utils/recordingPathBusy.ts`): the bar is mounted OUTSIDE
 * `AppRouter`'s tree, so nothing it does can unmount `AudioRecorder`. Its
 * only action is a scroll (`shared/utils/homeScreenScroll.ts`) — it sets no
 * route, no view, no mode and no status, and therefore cannot take the live
 * `MediaRecorder` down with it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * -----------------------------------
 * It does not start the microphone. The task brief is explicit — "do not
 * change recording behaviour ... the recorder's own logic stays exactly as
 * it is" — and every way to start a recording from here changes it: a second
 * `MediaRecorder` duplicates the pipeline, and a remote trigger added to
 * `AudioRecorder`/`AudioRecorderStreaming` is a new invocation path inside
 * the component the brief fences off. So the bar brings the farmer to the
 * recorder instead — the mirror image of the gesture the app already ships,
 * where tapping the DISABLED recorder scrolls the plot selector into view
 * (`onRequestContextSelection`, `core/navigation/mainView.tsx`). Flagged for
 * the founder in the Task 8 report, not silently decided.
 *
 * THE RESERVED BAND UNDER THE CONTROL IS NOT PADDING
 * -----------------------------------------------------
 * `BottomNavigation`'s centre "Schedule" button is raised (`-top-6`) and
 * MEASURED at 390x844 its circle spans y 740-820 while the nav's own top
 * edge is at 763 — it crests 23px above the nav. A bar sitting flush above
 * the nav is therefore crossed by it.
 *
 * The first attempt cut a mask notch out of the bar's bottom centre (the
 * technique `AudioRecorder.tsx` already uses on its own card for this exact
 * button). Rejected after looking at it: a 46px-radius half-disc bites 46px
 * out of a 72px-tall bar, and the label — which starts ~54px in and runs
 * ~140px for "आधी प्लॉट निवडा" — lands square on the cut. A clipped
 * farmer-facing label is a defect, not a saving.
 *
 * So the bar reserves {@link NAV_CREST_RESERVE_PX} of solid background
 * beneath the control instead. The crest sits on that band, the way it
 * already sits over page content today, and no text is ever cut. It costs
 * 28px of scrollable viewport, which is reported rather than hidden.
 */
import React from 'react';
import { Mic } from 'lucide-react';

import { useLanguage } from '../../../i18n/LanguageContext';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import type { AppRoute, PageView } from '../../../types';
import type { AppStatus } from '../../../domain/types/farm.types';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

/**
 * The bar's own painted height, in CSS pixels. Exported because `<main>`'s
 * bottom padding has to reserve exactly this much MORE room than it already
 * reserves for the nav, or the last card on the page hides underneath the
 * bar. One constant, two consumers (`AppContent.tsx` and the founder
 * preview), so the two can never drift.
 *
 * 72 = 8px top padding + a 56px button + 8px bottom padding. The 56 is the
 * tap-target floor (>= 44px, brief constraint 3) with room to spare, and is
 * deliberately smaller than the founder mock's 60px `.abtn`: every pixel
 * here comes straight out of the farmer's scrollable viewport.
 */
export const RECORD_BAR_HEIGHT_PX = 72;

/**
 * Solid background reserved BELOW the control for `BottomNavigation`'s
 * raised centre button. 28 = the measured 23px crest plus 5px, so the
 * button's rim never touches the control above it. See this file's header.
 */
export const NAV_CREST_RESERVE_PX = 28;

/** Everything the bar occupies above the nav. */
export const RECORD_BAR_BLOCK_PX = RECORD_BAR_HEIGHT_PX + NAV_CREST_RESERVE_PX;

/**
 * `<main>`'s bottom padding. `6rem` is the shipped value — 80px of nav plus
 * 16px of breathing room — and the bar's whole block is added on top when it
 * is showing, or the last card on the page hides underneath it.
 */
export function mainPaddingBottomFor(recordBarVisible: boolean): string {
    const base = recordBarVisible ? `6rem + ${RECORD_BAR_BLOCK_PX}px` : '6rem';
    return `calc(${base} + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))`;
}

export interface RecordBarVisibility {
    currentRoute: AppRoute;
    mainView: PageView;
    status: AppStatus;
    /** `LogSegment | null` — a targeted re-record of one segment. */
    recordingSegment: string | null;
    /** `'voice' | 'manual'`. */
    mode: string;
    /** The soft keyboard is up; `BottomNavigation` hides for the same reason. */
    keyboardOpen?: boolean;
}

/**
 * Whether the pinned bar belongs on screen at all.
 *
 * The status clause MIRRORS `renderLogView`'s own idle-branch condition
 * (`core/navigation/mainView.tsx`) — `confirming` / `success` / `processing`
 * replace the home screen with the parse-result screens, and a bar reading
 * "बोला" pinned over a confirmation card would be inviting the farmer to
 * speak over work he is being asked to check. It is NOT the recording guard:
 * `isRecordingPathBusy` exists to stop a view change destroying a live
 * recorder, and this predicate cannot cause one — see this file's header.
 */
export function shouldShowRecordBar({
    currentRoute,
    mainView,
    status,
    recordingSegment,
    mode,
    keyboardOpen = false,
}: RecordBarVisibility): boolean {
    if (currentRoute !== 'main' || mainView !== 'log') return false;
    if (status === 'confirming' || status === 'success' || status === 'processing') return false;
    // A segment re-record replaces the whole question-and-selector screen
    // with its own banner; "choose a plot / speak" describes nothing there.
    if (recordingSegment) return false;
    // Manual entry is a typing surface. The only two founder-approved
    // strings for this bar are "choose a plot first" and "speak" — there is
    // no approved Marathi for "write", and §6 forbids inventing one, so the
    // bar stands down rather than mislabel itself.
    if (mode !== 'voice') return false;
    if (keyboardOpen) return false;
    return true;
}

export interface RecordBarProps {
    /**
     * A plot (or Entire Farm) is chosen. Pass `hasActiveLogContext` — the
     * SAME value `AudioRecorder`'s own `disabled` prop is derived from
     * (`isContextReady`, `app/context/LogContext.tsx`), so the bar and the
     * recorder can never disagree about whether the farmer may speak.
     */
    active: boolean;
    /** Runs on tap, and only when `active`. */
    onActivate: () => void;
}

const RecordBar: React.FC<RecordBarProps> = ({ active, onActivate }) => {
    const { language } = useLanguage();
    const label = resolveOversightString(language, active ? 'recordBarActive' : 'recordBarIdle');

    return (
        <div
            data-testid="record-bar"
            className="pointer-events-none fixed left-0 right-0 z-40"
            style={{
                bottom: 'calc(5rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
                height: `${RECORD_BAR_BLOCK_PX}px`,
            }}
        >
            <div
                className="pointer-events-auto h-full border-t border-stone-100 bg-white/95 backdrop-blur-md shadow-[0_-8px_24px_-4px_rgba(0,0,0,0.10)]"
                // The reserve is bottom padding on the same painted box, not
                // a gap: page content must never be visible sliding between
                // the control and the nav. See this file's header.
                style={{ paddingBottom: `${NAV_CREST_RESERVE_PX}px` }}
            >
                <div className="page-content pl-safe-area pr-safe-area px-3 py-2" style={{ height: `${RECORD_BAR_HEIGHT_PX}px` }}>
                    <button
                        type="button"
                        data-testid="record-bar-button"
                        disabled={!active}
                        onClick={active ? onActivate : undefined}
                        aria-label={label}
                        className={`flex min-h-[56px] w-full items-center gap-3 rounded-[17px] px-3.5 transition-colors duration-200 ${active
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                            : 'cursor-not-allowed bg-stone-200 text-stone-500'
                            }`}
                    >
                        {/* spec §5.3 — "② on the record bar". Drawn as a
                            circle around a DM Sans digit, never the "②"
                            glyph: a single pre-composed character would fall
                            back to whatever font the device happens to have
                            it in, which the font rules forbid for visible
                            text. The circle also matches the numbered plot
                            markers `CropSelector` already draws, so the
                            sequence reads as one language. */}
                        <span
                            aria-hidden="true"
                            data-testid="record-bar-step"
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${active ? 'bg-white/20 text-white' : 'bg-black/10 text-stone-500'
                                }`}
                            style={ENGLISH_FONT}
                        >
                            2
                        </span>

                        <span
                            data-testid="record-bar-label"
                            className="min-w-0 flex-1 truncate text-left text-[16.5px] font-extrabold leading-tight"
                            style={fontStyleFor(label)}
                        >
                            {label}
                        </span>

                        <span
                            aria-hidden="true"
                            className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full ${active ? 'bg-white/20' : 'bg-black/[0.06]'
                                }`}
                        >
                            <Mic size={21} strokeWidth={2.2} />
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RecordBar;
