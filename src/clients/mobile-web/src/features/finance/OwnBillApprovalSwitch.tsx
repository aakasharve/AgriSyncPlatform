/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177, phone task P12; founder 27 Nov B1.4: "an owner switch for each farm; off unless the
 * owner turns it on") - the farm's switch on the team page, drawn for the PRIMARY owner only (the server refuses anyone else): may a person who checks
 * money approve a bill he made himself. It reads the farm's value from the pull (`accessScopes[].reviewerMayApproveOwnBill`, present only when on) and
 * changes it offline first through `farm.own_bill_approval.set`; a change not yet on the server says so, and a second tap while it waits replaces it
 * (never two rows). The server decides each approval when it ARRIVES. Words PROPOSED (contract §8a), with English twins; the page's font is inherited.
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

const WORDS = {
    mr: { label: 'पैसे तपासणारी व्यक्ती स्वतः केलेलं बिल स्वतः मंजूर करू शकते', line: 'बंद असेल तर असं बिल तुम्ही किंवा दुसरी परवानगी असलेली व्यक्ती मंजूर करेल.' },
    en: { label: 'A person who checks money may approve a bill they made themselves', line: 'When off, such a bill is approved by you or another person with permission.' },
} as const;

const OPEN = new Set(['PENDING', 'SENDING', 'FAILED']);

interface SwitchState { serverOn: boolean; waiting: MutationQueueItem | null }

async function readSwitch(farmId: string): Promise<SwitchState> {
    const db = getDatabase();
    const serverOn = scopeForFarm(await readAccessScopes(db), farmId)?.reviewerMayApproveOwnBill === true;
    const rows = (await db.mutationQueue.where('mutationType').equals(SyncMutationName.FarmOwnBillApprovalSet).toArray())
        .filter(r => OPEN.has(r.status) && (r.payload as { farmId?: unknown } | null)?.farmId === farmId)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return { serverOn, waiting: rows.pop() ?? null };
}

export const OwnBillApprovalSwitch: React.FC<{ farmId: string; isPrimaryOwner: boolean }> = ({ farmId, isPrimaryOwner }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? WORDS.en : WORDS.mr;
    const [state, setState] = useState<SwitchState | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!isPrimaryOwner) return;
        let alive = true;
        const sub = liveQuery(() => readSwitch(farmId)).subscribe({
            next: s => { if (alive) setState(s); },
            error: () => { if (alive) setState({ serverOn: false, waiting: null }); },
        });
        return () => { alive = false; sub.unsubscribe(); };
    }, [farmId, isPrimaryOwner]);

    if (!isPrimaryOwner || !state) return null;
    const waitingValue = (state.waiting?.payload as { allowed?: unknown } | undefined)?.allowed;
    const on = typeof waitingValue === 'boolean' ? waitingValue : state.serverOn;

    const toggle = async (next: boolean) => {
        const payload = { farmId, allowed: next };
        if (state.waiting?.status === 'SENDING') { setBusy(true); return; }
        setBusy(false);
        if (state.waiting) {
            await mutationQueue.replacePayload(state.waiting.clientRequestId, payload);
        } else {
            const clientRequestId = `${SyncMutationName.FarmOwnBillApprovalSet}:${farmId}:${idGenerator.generate()}`;
            await mutationQueue.enqueue(SyncMutationName.FarmOwnBillApprovalSet, payload, { clientRequestId, clientCommandId: clientRequestId });
        }
        backgroundSyncWorker.triggerNow().catch((err: unknown) => console.error('[OwnBillApprovalSwitch] sync run after queueing failed', err));
    };

    return (
        <div className="mb-3 space-y-1.5" data-testid="own-bill-approval">
            <SwitchRow on={on} onChange={v => { void toggle(v); }} label={words.label} testId="own-bill-switch" />
            <p className="m-0 px-1 text-[13px] font-semibold leading-snug text-stone-600">{words.line}</p>
            {state.waiting && <WaitingLine language={language} />}
            {busy && <p className="m-0 px-1 text-[13px] font-extrabold text-amber-800" role="status">{farmSetupWords(language).busy}</p>}
        </div>
    );
};
