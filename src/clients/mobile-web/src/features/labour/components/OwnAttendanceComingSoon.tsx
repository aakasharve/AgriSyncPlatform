/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLR-D10 L3a / D-35 (founder 2026-10-27: "YES — But need to show this as feature to be coming
 * soon"). A worker's OWN हजेरी is a real requirement (D-8, D-16), but it needs a safe link between
 * his login and his name in the farm's records first — never matched by name. Until that card is
 * built, his "हजेरी बघा" says so in plain words.
 *
 * Deliberately NOT a control (doctrine P5): no button, no link, no tap target — a muted note that
 * reads as information, so it can never look like something that does nothing. It also replaces the
 * bare grid a worker used to see, which looked like an empty record of his days.
 *
 * Copy: PROPOSED (Marathi) — founder wording review.
 */
import React from 'react';
import { Clock } from 'lucide-react';

export const OWN_ATTENDANCE_COMING_SOON = 'तुमची स्वतःची हजेरी इथे लवकरच दिसेल.'; // PROPOSED (Marathi)

const OwnAttendanceComingSoon: React.FC = () => (
    <div
        role="note"
        data-testid="own-attendance-coming-soon"
        className="flex items-center gap-3 rounded-[20px] border border-dashed border-stone-300 bg-stone-50 p-4 text-[17px] font-semibold leading-snug text-stone-600"
    >
        <Clock size={22} aria-hidden="true" className="flex-shrink-0 text-stone-400" />
        <span>{OWN_ATTENDANCE_COMING_SOON}</span>
    </div>
);

export default OwnAttendanceComingSoon;
