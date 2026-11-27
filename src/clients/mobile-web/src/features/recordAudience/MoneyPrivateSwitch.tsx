/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.1; founder 27 Nov follow-up 2 "पैशांच्या नोंदी फक्त मला दिसू दे";
 * CTO ruling Q5 A) - the farm's REGISTRANT's own line in माझी टीम (the server refuses anyone else, so nobody else is shown it, P5). It reads the
 * farm's value from the pull (`accessScopes[].moneyPrivate`, present only when on) and changes it offline first through `farm.money_private.set`; a
 * change not yet on the server says so, and a second tap while it waits replaces it (never two rows). The server stamps each NEW money record when
 * it arrives (founder 1-B: old records stay as they are). What it does not cover yet is written under it (Q5 A). The pattern of D-177's switch.
 */
import React, { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { SwitchRow } from '../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { getDatabase, type MutationQueueItem } from '../../infrastructure/storage/DexieDatabase';
import { readAccessScopes, scopeForFarm } from '../../infrastructure/storage/accessScopeStore';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { WaitingLine } from '../profile/farmSetup/FarmSetupLines';
import { farmSetupWords } from '../profile/farmSetup/farmSetupWords';
import { useIsFarmRegistrant } from './recordHolder';

const WORDS = {
    mr: {
        label: 'पैशांच्या नोंदी फक्त मला दिसू दे', // the founder's own words (27 Nov follow-up 2)
        on: 'यापुढच्या खर्च, बिलं आणि कामातील पैसे फक्त तुम्हाला आणि ज्याने नोंद केली त्याला दिसतील. आधीच्या नोंदी आहेत तशाच राहतील.', // PROPOSED (Marathi) - contract §2.1
        off: 'बंद असेल तर ज्यांना पैसे पाहण्याची परवानगी आहे त्यांना पैशांच्या नोंदी दिसतात.', // PROPOSED (Marathi)
        limit: 'उक्ते कामाचे पैसे आणि हजेरीवरची रोजची मजुरी यात अजून येत नाहीत — ती "इतरांची मजुरी पाहणे" प्रमाणेच दिसते.', // PROPOSED (Marathi) - CTO ruling Q5 A
    },
    en: {
        label: 'Only I see the money records', // PROPOSED (English)
        on: 'From now on, expenses, bills and the money in work records are seen only by you and the person who made the record. Earlier records stay as they are.', // PROPOSED (English)
        off: 'When off, money records are seen by the people allowed to see money.', // PROPOSED (English)
        limit: "Job-work pay and the daily wage on the attendance page are not covered yet — they follow \"See other people's wages\".", // PROPOSED (English)
    },
} as const;

const OPEN = new Set(['PENDING', 'SENDING', 'FAILED']);

interface SwitchState { serverOn: boolean; waiting: MutationQueueItem | null }

async function readSwitch(farmId: string): Promise<SwitchState> {
    const db = getDatabase();
    const serverOn = scopeForFarm(await readAccessScopes(db), farmId)?.moneyPrivate === true;
    const rows = (await db.mutationQueue.where('mutationType').equals(SyncMutationName.FarmMoneyPrivateSet).toArray())
        .filter(r => OPEN.has(r.status) && (r.payload as { farmId?: unknown } | null)?.farmId === farmId)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return { serverOn, waiting: rows.pop() ?? null };
}

export const MoneyPrivateSwitch: React.FC<{ farmId: string; selfUserId: string | null | undefined }> = ({ farmId, selfUserId }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? WORDS.en : WORDS.mr;
    const registrant = useIsFarmRegistrant(farmId, selfUserId);
    const [state, setState] = useState<SwitchState | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!registrant) return;
        let alive = true;
        const sub = liveQuery(() => readSwitch(farmId)).subscribe({
            next: s => { if (alive) setState(s); },
            error: () => { if (alive) setState({ serverOn: false, waiting: null }); },
        });
        return () => { alive = false; sub.unsubscribe(); };
    }, [farmId, registrant]);

    if (!registrant || !state) return null;
    const waitingValue = (state.waiting?.payload as { isPrivate?: unknown } | undefined)?.isPrivate;
    const on = typeof waitingValue === 'boolean' ? waitingValue : state.serverOn;

    const toggle = async (next: boolean) => {
        const payload = { farmId, isPrivate: next };
        if (state.waiting?.status === 'SENDING') { setBusy(true); return; }
        setBusy(false);
        if (state.waiting) {
            await mutationQueue.replacePayload(state.waiting.clientRequestId, payload);
        } else {
            const clientRequestId = `${SyncMutationName.FarmMoneyPrivateSet}:${farmId}:${idGenerator.generate()}`;
            await mutationQueue.enqueue(SyncMutationName.FarmMoneyPrivateSet, payload, { clientRequestId, clientCommandId: clientRequestId });
        }
        backgroundSyncWorker.triggerNow().catch((err: unknown) => console.error('[MoneyPrivateSwitch] sync run after queueing failed', err));
    };

    return (
        <div className="mb-3 space-y-1.5" data-testid="money-private">
            <SwitchRow on={on} onChange={v => { void toggle(v); }} label={words.label} testId="money-private-switch" />
            <p className="m-0 px-1 text-[13px] font-semibold leading-snug text-stone-600">{on ? words.on : words.off}</p>
            <p className="m-0 px-1 text-[13px] font-semibold leading-snug text-stone-600" data-testid="money-private-limit">{words.limit}</p>
            {state.waiting && <WaitingLine language={language} />}
            {busy && <p className="m-0 px-1 text-[13px] font-extrabold text-amber-800" role="status">{farmSetupWords(language).busy}</p>}
        </div>
    );
};

export default MoneyPrivateSwitch;
