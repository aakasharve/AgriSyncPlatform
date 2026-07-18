/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReviewSheet — ONE consolidated Marathi review sheet (replaces the app's
 * fragmented review surfaces). Each entry: who logged it + what, a big
 * "मंजूर" (approve) and a "शंका" (query). Reachable from Home and from Labour
 * Management — one screen, two doorways. Includes a "हे कसं चालतं?" helper.
 */
import React, { useState } from 'react';
import { X, Check, MessageSquare } from 'lucide-react';
import type { LabourData, ReviewVerificationStatus } from '../labourMock';
import { Avatar, HelpNote } from './LabourUiKit';
import LabourDataPoints from './LabourDataPoints';
import { VerifyLogCommand } from '../../../application/usecases/sync/VerifyLogCommand';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';

interface Props { open: boolean; data: LabourData; onClose: () => void; onToast: (m: string) => void }

const DISPUTE_REASON = 'मालकाने या नोंदीवर शंका घेतली आहे — कामगाराला विचारायचं आहे.';

async function triggerSyncBestEffort(): Promise<void> {
    try {
        await backgroundSyncWorker.triggerNow();
    } catch {
        // Queue persistence is the durable path; the periodic worker retries regardless.
    }
}

/**
 * Sends the `verify_log` transition(s) needed to reach `finalStatus` from
 * the review item's CURRENT server status. `VerificationStateMachine`
 * (ShramSafal.Domain.Logs) forbids a one-hop Draft→Verified/Disputed: a
 * `Draft` item needs Draft→Confirmed first (any farm role may do that),
 * THEN Confirmed→{Verified|Disputed} (owner-tier roles). A `Confirmed` (or
 * already-`Verified`, for the शंका/dispute case) item reaches the target in
 * one hop.
 *
 * The two mutations are enqueued in order, each `await`ed before the next —
 * `BackgroundSyncWorker.pushPendingMutations` batches ALL pending rows by
 * ascending queue id (insertion order) into one `/sync/push` call, and
 * `PushSyncBatchHandler` applies a batch's mutations sequentially, each in
 * its own committed transaction, so the Confirmed step is durable on the
 * server before the Verified/Disputed step is evaluated against it — even
 * if the two end up split across sync cycles.
 *
 * Exported for `reviewApprove.test.ts` — it is the actual "does तपासणी
 * reach the real approval engine" contract, independent of the button
 * wiring around it.
 */
export async function sendVerification(
    dailyLogId: string,
    currentStatus: ReviewVerificationStatus | undefined,
    finalStatus: 'verified' | 'disputed',
    reason?: string
): Promise<void> {
    const canGoDirectly = currentStatus === 'Confirmed' || currentStatus === 'Verified';
    if (!canGoDirectly) {
        await VerifyLogCommand.enqueue({ dailyLogId, verificationStatus: 'confirmed' });
    }
    await VerifyLogCommand.enqueue({ dailyLogId, verificationStatus: finalStatus, reason });
    await triggerSyncBestEffort();
}

const ReviewSheet: React.FC<Props> = ({ open, data, onClose, onToast }) => {
    const [gone, setGone] = useState<Record<string, boolean>>({});
    const items = data.review.filter((i) => !gone[i.id]);

    const approve = async (id: string) => {
        const item = data.review.find((i) => i.id === id);
        try {
            await sendVerification(id, item?.status, 'verified');
            setGone((g) => ({ ...g, [id]: true }));
            onToast('मंजूर ✓ — हजेरीही निश्चित');
        } catch {
            // Do NOT fabricate success — the card stays put so the farmer
            // can retry; enqueue() failed locally (before any network call).
            onToast('मंजूर करता आलं नाही — पुन्हा प्रयत्न करा');
        }
    };

    const query = async (id: string) => {
        const item = data.review.find((i) => i.id === id);
        try {
            await sendVerification(id, item?.status, 'disputed', DISPUTE_REASON);
            setGone((g) => ({ ...g, [id]: true }));
            onToast('शंका नोंदवा — कामगाराला विचारता येईल');
        } catch {
            onToast('शंका नोंदवता आली नाही — पुन्हा प्रयत्न करा');
        }
    };

    const approveAll = async () => {
        const targets = items;
        const failedIds = new Set<string>();
        for (const it of targets) {
            try {
                await sendVerification(it.id, it.status, 'verified');
            } catch {
                failedIds.add(it.id);
            }
        }
        setGone((g) => {
            const next = { ...g };
            targets.forEach((it) => { if (!failedIds.has(it.id)) next[it.id] = true; });
            return next;
        });
        onToast(failedIds.size === 0
            ? 'सगळं मंजूर ✓'
            : `${failedIds.size} नोंदी मंजूर करता आल्या नाहीत — पुन्हा प्रयत्न करा`);
    };

    return (
        <>
            <div onClick={onClose} className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
            <div className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[88%] flex-col rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 ${open ? 'translate-y-0' : 'translate-y-full'}`}>
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" />
                <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-2.5 pt-1.5">
                    <div>
                        <h2 className="text-[17px] font-bold text-slate-800">तपासणी</h2>
                        <p className="text-[11.5px] text-slate-500">{items.length ? `टीमच्या ${items.length} नोंदी — मंजूर करा` : 'सगळं झालं ✓'}</p>
                    </div>
                    <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"><X size={18} /></button>
                </div>
                <div className="flex flex-col gap-2 overflow-y-auto p-3">
                    <HelpNote
                        what="तुमच्या टीमने केलेल्या रोजच्या नोंदी इथे तुम्ही मंजूर करता."
                        act="बरोबर असेल तर 'मंजूर', काही चुकलं असेल तर 'शंका' — नंतर विचारता येतं."
                        why="चुका आधीच पकडल्या जातात व हिशोब बरोबर राहतो. ज्याच्यावर विश्वास दिला, त्याच्या नोंदी इथे येत नाहीत — आपोआप मंजूर."
                        label="तपासणी म्हणजे काय?"
                    />
                    {items.length > 1 && (
                        <button type="button" onClick={() => approveAll()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-emerald-200 active:scale-[0.98]"><Check size={17} strokeWidth={2.5} /> सगळं मंजूर ({items.length})</button>
                    )}
                    {items.map((it) => (
                        <div key={it.id} className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                            <div className="flex items-center gap-2.5">
                                <Avatar tone={it.tone} initial={it.initial} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 text-[14px] font-bold text-slate-800">{it.who} <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">आज</span></div>
                                    <div className="truncate text-[11.5px] text-slate-500">{it.detail}</div>
                                </div>
                            </div>
                            <div className="mt-2"><LabourDataPoints entry={it.points} /></div>
                            <div className="mt-2 flex gap-2">
                                <button type="button" onClick={() => approve(it.id)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-[12.5px] font-extrabold text-white active:scale-[0.98]"><Check size={15} strokeWidth={2.6} /> मंजूर</button>
                                <button type="button" onClick={() => query(it.id)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[12.5px] font-bold text-slate-600 active:scale-[0.98]"><MessageSquare size={15} /> शंका</button>
                            </div>
                        </div>
                    ))}
                    {items.length === 0 && (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Check size={30} /></div>
                            <p className="text-[15px] font-bold text-slate-800">फार्म बुक अद्ययावत आहे</p>
                            <p className="mt-1 text-[12.5px] text-slate-500">तपासायला काही उरलं नाही.</p>
                        </div>
                    )}
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-600">मंजूर केल्यावर हजेरीही निश्चित होते. हीच स्क्रीन घरातून <b>आणि</b> कामगार व्यवस्थापनातून उघडते.</div>
                </div>
            </div>
        </>
    );
};

export default ReviewSheet;
