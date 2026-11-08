/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-A (founder D-74): the badge that says whether ShramSafal has
 * checked a schedule, day by day.
 *
 * It is drawn from the SERVER'S record only (`CropScheduleTemplate.check`, the library's `check`). A schedule that carries no
 * check - every built-in sample, every row made before the lane, an edited copy, a checked schedule whose approval was taken
 * back or sent back - reads the grey "not checked" words. Nothing here decides a check, and no client flag can make one (P4).
 */
import React from 'react';
import { BadgeCheck, CircleDashed } from 'lucide-react';
import type { CropScheduleTemplate } from '../scheduler.types';
import { SC } from '../schedulePage/scheduleCopy';

/** "12 नोव्हें 2026" - Marathi month, the app's Latin digits. Unreadable dates are left out, never guessed. */
export function checkDateLabel(iso: string | undefined): string | null {
    if (!iso) return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    try {
        return new Intl.DateTimeFormat('mr-IN-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(at);
    } catch {
        return at.toISOString().slice(0, 10);
    }
}

export const ScheduleCheckBadge: React.FC<{ template: Pick<CropScheduleTemplate, 'check'>; tone?: 'light' | 'dark'; testId?: string }> = ({
    template,
    tone = 'light',
    testId = 'schedule-check',
}) => {
    const check = template.check;
    const dark = tone === 'dark';
    if (check?.state === 'Checked') {
        const who = [check.checkerName, checkDateLabel(check.checkedAt)].filter(Boolean).join(' · ');
        return (
            <div className="mt-1.5" data-testid={testId} data-check-state="Checked">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-extrabold ${dark ? 'border border-emerald-300/40 bg-emerald-500/25 text-emerald-100' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'}`}>
                    <BadgeCheck size={16} aria-hidden="true" />{SC.checkedByShramSafal}
                </span>
                {who && <p className={`m-0 mt-0.5 text-[13px] font-bold ${dark ? 'text-white/75' : 'text-stone-600'}`} data-testid={`${testId}-who`}>{who}</p>}
            </div>
        );
    }
    return (
        <div className="mt-1.5" data-testid={testId} data-check-state="NotChecked">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-extrabold ${dark ? 'border border-white/20 bg-white/10 text-white/70' : 'bg-stone-100 text-stone-600 ring-1 ring-stone-200'}`}>
                <CircleDashed size={16} aria-hidden="true" />{SC.notCheckedByShramSafal}
            </span>
        </div>
    );
};

export default ScheduleCheckBadge;
