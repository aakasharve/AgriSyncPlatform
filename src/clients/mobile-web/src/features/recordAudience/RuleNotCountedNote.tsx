/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV (founder D-26; orchestrator call 8) — W4 under a total that leaves a record out by rule:
 * "श्रमसफलच्या नियमानुसार काही नोंदी या हिशोबात धरलेल्या नाहीत." The server says, per farm, which days hold a record kept
 * from this person (`accessScopes[].withheldRecordDays`, content-free: kind + day); a total covering such a day says so.
 * A total that covers no such day says nothing (never a false "incomplete").
 */
import React, { useEffect, useState } from 'react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { ruleWithheldCopy } from '../../i18n/ruleWithheldTranslations';
import type { FarmAccessScopeDto } from '../../infrastructure/api/accessScopeDtos';
import { readAccessScopes } from '../../infrastructure/storage/accessScopeStore';

export type WithheldKind = 'work' | 'money';

/**
 * Does a total of <paramref name="kind"/> on these farms, over these days, leave a record out by rule? `farmIds`
 * undefined = every farm; `from`/`to` (`YYYY-MM-DD`, inclusive) undefined = every day.
 */
export function totalLeavesOut(
    scopes: readonly FarmAccessScopeDto[] | null | undefined,
    kind: WithheldKind,
    farmIds?: readonly string[],
    from?: string,
    to?: string,
): boolean {
    return (scopes ?? []).some(scope =>
        (!farmIds || farmIds.includes(scope.farmId))
        && (scope.withheldRecordDays ?? []).some(day =>
            day.kind === kind && (!from || day.date >= from) && (!to || day.date <= to)));
}

/** The W4 line, shown only when the total it sits under leaves a record out. */
export const RuleNotCountedNote: React.FC<{ kind: WithheldKind; farmIds?: readonly string[]; from?: string; to?: string; testId?: string }> = ({
    kind, farmIds, from, to, testId = 'rule-not-counted',
}) => {
    const language = useOptionalLanguage()?.language;
    const [scopes, setScopes] = useState<FarmAccessScopeDto[] | null>(null);
    useEffect(() => {
        let live = true;
        const read = () => {
            readAccessScopes()
                .then(stored => { if (live) setScopes(stored?.scopes ?? null); })
                .catch(error => console.warn('RuleNotCountedNote: the stored scopes could not be read', error));
        };
        read();
        window.addEventListener('agrisync:sync-reconciled', read);
        return () => {
            live = false;
            window.removeEventListener('agrisync:sync-reconciled', read);
        };
    }, []);
    if (!totalLeavesOut(scopes, kind, farmIds, from, to)) return null;
    return (
        <p className="m-0 rounded-2xl bg-stone-100 p-3 text-[13.5px] font-bold leading-snug text-stone-700" data-testid={testId} role="note">
            {ruleWithheldCopy(language).notCounted}
        </p>
    );
};

export default RuleNotCountedNote;
