/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.3; founder 27 Nov: "हे दिसतं: मालक, मुकादम" on the saved screen and
 * "keep one redirect button ... change your setting") - ONE read-only line on the saved screen, for everyone who records, and for the farm's
 * registrant one "सेटिंग बदला" that opens माझी टीम (nobody else can change it, P5). Small and on its own: the result screen is redesigned soon.
 *
 * Built from the pull's name-free `seenBy` (asked with `seenBy=1`) ONLY: with no summary stored for the farm, nothing is drawn (P4: never
 * guessed). The registrant is implied and named first ("तुम्ही" when he is the one reading); the reader himself is never in the list. A seat on
 * chosen plots is named only when the record is on one of them (a whole-farm record: every seat). A record that states money adds who sees its
 * money - "फक्त मालक" while the farm's money is private. Old records keep the audience they had (founder 1-B); this line speaks of the farm's
 * setting now, for the record just saved.
 */
import React from 'react';
import { Settings2 } from 'lucide-react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { useStoredAccessScopes } from '../../core/session/storedFarmScope';
import { isReadableScope, scopeForFarm } from '../../infrastructure/storage/accessScopeStore';
import type { SeenByEntryDto } from '../../infrastructure/api/accessScopeDtos';
import type { DailyLog } from '../../types';
import {
    statedExpenseAmount, statedInputAmount, statedLabourAmount, statedMachineryAmount,
} from '../finance/recordMoneyLines';
import { useIsFarmRegistrant } from './recordHolder';
import { requestOpenTeamSetting } from './teamSettingLink';
import { seenByWords, type SeenByWords } from './seenByWords';

/** The seat kinds in the order the line names them (the registrant is always first, before these). */
const ORDER = ['CoOwner', 'Family', 'SecondaryOwner', 'Mukadam', 'Worker'];

/** The plots the records are on; empty = a whole-farm record. */
const plotsOf = (logs: readonly DailyLog[]): Set<string> =>
    new Set(logs.flatMap(l => (l.context?.selection ?? []).flatMap(s => s.selectedPlotIds ?? [])).filter(Boolean));

/** Does any of these records state an amount of money (the same "stated" rule the money capture reads)? */
export function statesMoney(logs: readonly DailyLog[]): boolean {
    return logs.some(l => (l.labour ?? []).some(e => (statedLabourAmount(e) ?? 0) > 0)
        || (l.inputs ?? []).some(e => (statedInputAmount(e) ?? 0) > 0)
        || (l.machinery ?? []).some(e => statedMachineryAmount(e) > 0)
        || (l.activityExpenses ?? []).some(e => statedExpenseAmount(e) > 0));
}

/** The seat words of the entries that see a record on these plots, once each, in the line's order. */
function seatsFor(entries: readonly SeenByEntryDto[], plots: ReadonlySet<string>, w: SeenByWords): string[] {
    const kinds = new Set<string>();
    for (const e of entries) {
        const onPlots = !Array.isArray(e.plotIds) || plots.size === 0 || e.plotIds.some(id => plots.has(id));
        if (onPlots && typeof e.who === 'string') kinds.add(e.who);
    }
    const known = ORDER.filter(k => kinds.has(k)).map(k => w.seat[k]);
    const unknown = [...kinds].some(k => !ORDER.includes(k)) ? [w.otherSeat] : [];
    return [...new Set([...known, ...unknown])];
}

export interface SeenByLineProps {
    farmId: string | null | undefined;
    /** The records just saved. */
    logs: readonly DailyLog[];
    /** The reader's server id. */
    selfUserId: string | null | undefined;
    testId?: string;
    /** Extra classes on the line's box (its place on the screen). */
    className?: string;
}

export const SeenByLine: React.FC<SeenByLineProps> = ({ farmId, logs, selfUserId, testId = 'seen-by', className = '' }) => {
    const w = seenByWords(useOptionalLanguage()?.language);
    const stored = useStoredAccessScopes();
    const isHolder = useIsFarmRegistrant(farmId, selfUserId);
    const scope = scopeForFarm(stored, farmId);
    const seenBy = scope && isReadableScope(scope) ? scope.seenBy : undefined;
    if (!seenBy || logs.length === 0) return null;

    const plots = plotsOf(logs);
    const first = isHolder ? w.you : w.holder;
    const workWho = [first, ...seatsFor(seenBy.work ?? [], plots, w)].join(', ');
    const money = statesMoney(logs);
    const moneyPrivate = scope?.moneyPrivate === true;
    const moneyWho = !money ? null
        : moneyPrivate ? w.only(first)
            : [first, ...seatsFor(seenBy.money ?? [], plots, w)].join(', ');

    return (
        <div className={`flex flex-wrap items-center gap-2 rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200 ${className}`} data-testid={testId}>
            <p className="m-0 min-w-0 flex-1 text-[14px] font-bold leading-snug text-stone-700" data-testid={`${testId}-line`}>
                {w.line(workWho)}{moneyWho !== null && w.money(moneyWho)}
            </p>
            {isHolder && (
                <button type="button" onClick={() => requestOpenTeamSetting(money ? 'money' : undefined)} data-testid={`${testId}-change`}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[14px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">
                    <Settings2 size={16} aria-hidden="true" />{w.change}
                </button>
            )}
        </div>
    );
};

export default SeenByLine;
