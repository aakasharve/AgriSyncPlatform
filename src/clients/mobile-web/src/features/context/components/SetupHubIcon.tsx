/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SetupHubIcon — the picture on the Setup Hub button in the header (founder-approved 2026-10-25, "trial v3").
 *
 * The royal brass-and-green treatment belongs to the farm NAMEBOARD alone; the Setup Hub beside it is plain and professional: the convention every
 * phone app uses for "settings" — a round button with a soft green fill, a hairline green edge and the standard gear line icon (the app's
 * Lucide set), so it sits quietly beside the nameboard.
 *   - idle: still;
 *   - on a tap (`tap` goes up by one): the button presses in and springs back and two soft green rings spread out and fade (a ripple). The effect
 *     is short and never delays the navigation.
 * Decorative only: the button carries the label.
 */
import React from 'react';
import { Settings } from 'lucide-react';

interface Props {
  /** Goes up by one on every tap; 0 = never tapped. Each change replays the effect. */
  tap: number;
  /** Lane OF (founder D-59) — recordings not saved yet; a number on the gear when above 0. */
  count?: number;
  /** The number's words for a screen reader. */
  countLabel?: string;
}

export const SetupHubIcon: React.FC<Props> = ({ tap, count = 0, countLabel }) => (
  <span className="relative block h-[50px] w-[50px]" data-testid="setup-hub-icon" data-tap={tap}>
    {count > 0 && (
      <span data-testid="setup-hub-count" aria-label={countLabel}
        className="absolute -right-1 -top-1 z-10 grid h-[22px] min-w-[22px] place-items-center rounded-full bg-red-600 px-1 text-[12px] font-extrabold leading-none text-white ring-2 ring-white">
        {count}
      </span>
    )}
    {tap > 0 && (
      <>
        <span key={`r1-${tap}`} data-testid="setup-hub-ripple" aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-hub-ripple rounded-full border-2 border-emerald-400" />
        <span key={`r2-${tap}`} aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-hub-ripple rounded-full border-2 border-emerald-200 [animation-delay:140ms]" />
      </>
    )}
    <span key={`p-${tap}`} className={`block h-full w-full ${tap > 0 ? 'animate-hub-press' : ''}`}>
      <span data-testid="setup-hub-frame"
        className="grid h-full w-full place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_1px_3px_rgba(28,25,23,0.10)]">
        <Settings size={27} strokeWidth={2.1} aria-hidden="true" data-nav-icon="settings" />
      </span>
    </span>
  </span>
);

export default SetupHubIcon;
