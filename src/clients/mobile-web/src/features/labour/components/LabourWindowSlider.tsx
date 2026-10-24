/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourWindowSlider — the आढावा screen's time-window control (Task 11, spec:
 * 2026-08-28-labour-v2-release-1). Four windows, one selected at a time:
 * आजपर्यंत · आज · हा आठवडा · हा महिना (`labourWindow.ts` owns the words).
 *
 * WHY A NEW COMPONENT, AND WHAT IT BORROWS.
 * Three segmented controls already exist and none of them fits:
 *   - `oversight/components/OversightNavCards.tsx` — the visual language the
 *     founder pointed at ([ आजची कामे ][ माझं शेत ][ तुलना ]). It is bound to
 *     `PageView` and to `resolveOversightString`/`Language`, so it can only
 *     ever render those three app routes in two languages; and its active
 *     state APPEARS and DISAPPEARS between cards rather than travelling, which
 *     is the one thing the founder asked for ("sliding UI"). Its LOOK is
 *     reused here verbatim — the emerald-50 tint, the emerald-200 border, the
 *     emerald-700 text, the stone-200/white rest state, the 3px emerald
 *     underline, the `rounded-2xl` card, `hapticFeedback.medium()` on tap.
 *   - `shared/components/ui/PageToggle.tsx` — same `PageView` binding, plus
 *     `useLanguage()`, and 10.5px text (its own comment records that it was
 *     measured down to fit beside the farm chip; this screen has the full
 *     width and a low-literacy reader who needs the larger ramp).
 *   - `shared/components/ui/InputMethodToggle.tsx` — hard-wired to exactly
 *     two options (voice/manual), each its own literal button.
 * Rewriting any of them to take arbitrary options would drag `PageView` and
 * the i18n context into a feature that has neither, so this is a fourth,
 * small, feature-local control that copies the treatment rather than the code.
 *
 * WHAT ACTUALLY SLIDES: one absolutely-positioned thumb behind the four
 * buttons, moved by `translateX` with a transition. The four buttons keep
 * their fixed grid cells; only the tint travels, so the selection reads as
 * moving ALONG a track rather than jumping between separate cards. That is the
 * founder's "sliding UI that can show this week today and this month records".
 *
 * NO TRUNCATION, DELIBERATELY. `हा आठवडा` and `हा महिना` are two words and
 * wrap to a second line on a narrow phone; the labels are allowed to wrap
 * instead of being clipped, for the reason `CanonicalStrip.tsx` records for
 * its own subtitle — a half-word ending in an ellipsis is worse than a second
 * line for a reader who may not read "…" as "continues". `leading-[1.3]`
 * because Devanagari carries matras above and below the line.
 *
 * THIS CONTROL HOLDS NO STATE AND FETCHES NOTHING. It renders the window it
 * is given and reports taps upward; `useLabourState` owns the selection and
 * is the only thing that re-asks the server.
 */
import React from 'react';
import { LABOUR_WINDOW_LABELS, LABOUR_WINDOW_ORDER, type LabourWindow } from '../labourWindow';
import { hapticFeedback } from '../../../shared/utils/haptics';

export interface LabourWindowSliderProps {
    /** The window currently in force — the one the data on screen answers for. */
    value: LabourWindow;
    /** Fired with the tapped window. Never called for a re-tap of `value`. */
    onChange: (window: LabourWindow) => void;
}

const LabourWindowSlider: React.FC<LabourWindowSliderProps> = ({ value, onChange }) => {
    // `LABOUR_WINDOW_ORDER` contains every `LabourWindow`, so this can only be
    // -1 if `value` were outside the union — impossible in TypeScript, and
    // clamped rather than left to move the thumb off-track if it ever were.
    const activeIndex = Math.max(0, LABOUR_WINDOW_ORDER.indexOf(value));

    return (
        <div
            role="tablist"
            aria-orientation="horizontal"
            data-testid="labour-window-slider"
            className="relative grid grid-cols-4 rounded-2xl border border-stone-200 bg-white p-1 shadow-[0_1px_3px_rgba(20,40,30,0.05)]"
        >
            {/* The thing that slides. `p-1` on the track is 4px per side, so a
                cell is (100% − 8px) / 4 wide and each step is one full cell. */}
            <span
                aria-hidden="true"
                data-testid="labour-window-slider-thumb"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl border border-emerald-200 bg-emerald-50 transition-transform duration-300 ease-out"
                style={{
                    width: 'calc((100% - 0.5rem) / 4)',
                    transform: `translateX(${activeIndex * 100}%)`,
                }}
            />

            {LABOUR_WINDOW_ORDER.map((window) => {
                const isActive = window === value;
                const label = LABOUR_WINDOW_LABELS[window];

                return (
                    <button
                        key={window}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        data-testid={`labour-window-${window}`}
                        onClick={() => {
                            // Re-tapping the window already in force asks the
                            // hook for nothing new; `useState` would bail out
                            // anyway, but not calling up at all keeps that
                            // guarantee here rather than borrowed from React.
                            if (isActive) return;
                            hapticFeedback.medium();
                            onChange(window);
                        }}
                        className={`relative z-10 flex min-h-[52px] min-w-0 items-center justify-center rounded-xl px-1.5 text-center text-[15px] font-extrabold leading-[1.3] transition-colors duration-200 ${
                            isActive ? 'text-emerald-700' : 'text-stone-500'
                        }`}
                    >
                        {label}
                        {isActive && (
                            <span
                                aria-hidden="true"
                                data-testid={`labour-window-${window}-underline`}
                                className="absolute bottom-[3px] left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full bg-emerald-600"
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default LabourWindowSlider;
