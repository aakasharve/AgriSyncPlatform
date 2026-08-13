/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FarmWideTodayPanel — what the farmer recorded for the WHOLE FARM today.
 *
 * Founder ask, verbatim: *"add it and show it on reflect page as well, only
 * when anything for entire farm is being logged."*
 *
 * ── WHY IT IS ITS OWN SURFACE AND NOT A NUMBER IN AN EXISTING ONE ────────────
 * When the farmer's context IS the whole farm, `mainView` derives plot ids from
 * it, gets none, and passes `{}` — so `ManualEntry` shows zeros for a day in
 * which he recorded whole-farm work. The tempting fix is to make
 * `getTodayCounts` return farm-wide logs; ruling `R24` measured what that does.
 * Its consumer SUMS per-plot maps across the plots in context, so one farm-wide
 * record is counted once per plot and a plot with 3 labour entries reports 11.
 *
 * So this panel reads `getFarmWideDaySummary`, which takes no plotId and
 * returns no per-plot key. There is no shape in which its numbers can be added
 * to a plot's. That is the whole design.
 *
 * ── IT RENDERS NOTHING WHEN THERE IS NOTHING ─────────────────────────────────
 * No empty state, no zero row, no "0 records for the whole farm". An emptiness
 * that exists only to be filled is a nag on the capture path (`P9`), and this
 * sits on the capture path.
 *
 * ── THE COPY IS BORROWED, NOT INVENTED ───────────────────────────────────────
 * `Entire Farm` is the app's OWN shipped label for this scope
 * (`CropSelector.tsx:283`, `LogFactory.FARM_GLOBAL_NAME`,
 * `appContentContextDisplay.tsx:52`); `संपूर्ण शेत` exists only in code
 * comments and has never reached a farmer. The summary line is
 * `dfes.todaySummary`, already approved in both languages. The bucket labels
 * are the same five `mainView` prints on the success card. No agent invented
 * farmer-facing Marathi here.
 *
 * ── AND IT SPLITS NOTHING ────────────────────────────────────────────────────
 * `statedSpend` is shown WHOLE, at the scope the farmer asserted. Showing a
 * per-plot share of a farm-wide amount would ship the finance feature inside a
 * labour panel and invent an allocation he never gave (`O-2`). That split has a
 * home — `DayLedger` / `ExpenseAllocationPolicy` — and it is a Finance ticket.
 */
import React from 'react';
import { Droplets, Users, Package, Tractor, Sprout, Warehouse } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { tf } from '../../../i18n/translations';
import { formatCurrencyINR } from '../../../shared/utils/dayState';
import type { FarmWideDaySummary } from '../../../app/helpers/appContentDailyCounts';

interface FarmWideTodayPanelProps {
    summary: FarmWideDaySummary;
}

export const FarmWideTodayPanel: React.FC<FarmWideTodayPanelProps> = ({ summary }) => {
    const { language } = useLanguage();

    // Nothing recorded at farm level today -> render nothing at all.
    if (summary.recordCount === 0) return null;

    const { counts, statedSpend, recordCount } = summary;

    // "Activities" in the sense `dfes.todaySummary` already uses: things done,
    // counted once each. Observations and reminders are notes, not work, and
    // are deliberately excluded so the figure matches what the farmer sees
    // listed below it.
    const activityCount =
        counts.cropActivities + counts.irrigation + counts.labour
        + counts.inputs + counts.machinery;

    const buckets = [
        { key: 'labour', count: counts.labour, icon: <Users size={13} />, label: 'Labour', color: 'bg-amber-100 text-amber-700' },
        { key: 'irrigation', count: counts.irrigation, icon: <Droplets size={13} />, label: 'Irrigation', color: 'bg-blue-100 text-blue-700' },
        { key: 'inputs', count: counts.inputs, icon: <Package size={13} />, label: 'Inputs', color: 'bg-purple-100 text-purple-700' },
        { key: 'machinery', count: counts.machinery, icon: <Tractor size={13} />, label: 'Machinery', color: 'bg-stone-100 text-stone-700' },
        { key: 'crop', count: counts.cropActivities, icon: <Sprout size={13} />, label: 'Crop Work', color: 'bg-emerald-100 text-emerald-700' },
    ].filter(bucket => bucket.count > 0);

    return (
        <div
            data-testid="farm-wide-today-panel"
            className="mb-3 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-sm"
        >
            <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500">
                    <Warehouse size={18} />
                </span>
                <div className="min-w-0 flex-1">
                    {/* `stone-500`, NOT `stone-400`. This eyebrow mirrors the
                        "Stored In" one on the success card, which already ships
                        `stone-500`; at `stone-400` it measured 2.52:1 — below AA
                        — and diverged from the thing it is imitating. A new file
                        gets the fix rather than inheriting the debt. */}
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">
                        Entire Farm
                    </p>
                    <p className="text-[13px] font-bold leading-snug text-stone-800">
                        {tf('dfes.todaySummary', language, {
                            activities: activityCount,
                            cost: formatCurrencyINR(statedSpend),
                        })}
                    </p>
                </div>
                <span
                    data-testid="farm-wide-record-count"
                    className="flex-shrink-0 rounded-lg bg-stone-100 px-2 py-1 text-[11px] font-bold text-stone-500"
                >
                    {recordCount}
                </span>
            </div>

            {buckets.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                    {buckets.map(bucket => (
                        <span
                            key={bucket.key}
                            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${bucket.color}`}
                        >
                            {bucket.icon}
                            {bucket.label} ×{bucket.count}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FarmWideTodayPanel;
