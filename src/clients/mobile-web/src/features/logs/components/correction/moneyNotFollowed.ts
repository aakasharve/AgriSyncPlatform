/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89) — when the money of an edit he saved could NOT
 * follow it (money saved the old way or not arrived, money shared out across plots or a job card's, a record whose first
 * details the server never held, a farm that may not write money now), he is told so in plain words on the बदला screen
 * and the result screen, in his language only. The reasons come from the server's answer to that edit, kept on this phone
 * (`editMoney.ts`); a later edit whose money followed clears them.
 */
import { useEffect, useState } from 'react';
import { readMoneyNotFollowed, type MoneyNotFollowedReason } from '../../../finance/editMoney';
import { correctionWords } from './correctionWords';

/** One plain line per reason, never repeated, in his language. */
export function moneyNotFollowedLines(reasons: readonly string[], language: string | null | undefined): string[] {
    const words = correctionWords(language).moneyNotFollowed;
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const reason of reasons) {
        const line = words[reason as MoneyNotFollowedReason] ?? words.notFound;
        if (!seen.has(line)) {
            seen.add(line);
            lines.push(line);
        }
    }
    return lines;
}

/**
 * The reasons for the entries of one screen (one entry on the बदला screen, the entries of one recording on the result
 * screen), read again whenever `refreshKey` changes (the app's last sync), so an answer that arrives while the screen is
 * open is said there.
 */
export function useMoneyNotFollowedOf(
    logIds: readonly string[],
    read: (id: string) => Promise<string[]> = readMoneyNotFollowed,
    refreshKey?: unknown,
): string[] {
    const [reasons, setReasons] = useState<string[]>([]);
    const key = logIds.join(',');
    useEffect(() => {
        let alive = true;
        const ids = key ? key.split(',') : [];
        if (ids.length === 0) { setReasons([]); return undefined; }
        void Promise.all(ids.map(id => read(id))).then(all => {
            if (alive) setReasons(all.flat());
        });
        return () => { alive = false; };
    }, [key, read, refreshKey]);
    return reasons;
}
