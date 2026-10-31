/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "नेट नसताना केलेल्या नोंदी" — the bill / sale-slip photos made without internet whose answer has come back and that he
 * has not acted on yet (`pendingAiJobs.result`).
 *
 * Lane OF (founder D-59 = 3A, 2026-10-31): VOICE recordings no longer live here. A recording not understood yet, or
 * understood and not saved, lives in सेट-अप केंद्र › आवाज नोंदी with a number on the gear and on that row, and an
 * understood one opens "तपासा आणि जतन करा" — never the old hand-filled form, which this page used to open. A bill or slip
 * photo is not voice, so it keeps this page: it cannot be opened here yet (that surface is not built), the row says so
 * plainly, and it is kept until he removes it. A removal is his explicit decision (`markAiResultReviewed`), never a
 * glance.
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Receipt, Trash2 } from 'lucide-react';
import { PageBar } from '../shared/components/ui/placeUi';
import {
    listUnreviewedAiResults,
    markAiResultReviewed,
    resolveRecordedInstant,
    type UnreviewedAiResult,
} from '../infrastructure/sync/PendingAiResultsReader';
import { logger } from '../infrastructure/observability/Logger';
import {
    DRAFTS_DISCARD,
    DRAFTS_EMPTY_LINE,
    DRAFTS_EMPTY_TITLE,
    DRAFTS_LINE,
    DRAFTS_LOADING,
    DRAFTS_NOT_OPENABLE,
    DRAFTS_TITLE,
    discardConfirmMessage,
    formatRecordedAt,
    previewLabel,
} from './aiDraftsCopy';

interface AiDraftsPageProps {
    onBack: () => void;
}

/** Only what is not voice: a bill or a sale-slip photo (voice lives in आवाज नोंदी). */
export const isPhotoResult = (job: UnreviewedAiResult): boolean => job.operationType !== 'voice_parse';

const AiDraftsPage: React.FC<AiDraftsPageProps> = ({ onBack }) => {
    const [drafts, setDrafts] = useState<UnreviewedAiResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyJobId, setBusyJobId] = useState<number | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setDrafts((await listUnreviewedAiResults()).filter(isPhotoResult));
        } catch (error) {
            logger.warn('offline photo results could not be read', { error: String(error) });
            setDrafts([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleDiscard = async (job: UnreviewedAiResult) => {
        if (!window.confirm(discardConfirmMessage(job))) {
            return;
        }
        setBusyJobId(job.id);
        try {
            await markAiResultReviewed(job.id);
            await refresh();
        } finally {
            setBusyJobId(null);
        }
    };

    return (
        <div className="pb-24 min-h-screen" data-testid="ai-drafts-list">
            <PageBar title={DRAFTS_TITLE} onBack={onBack} />
            <p className="mb-4 text-sm font-semibold text-stone-600">{DRAFTS_LINE}</p>

            {loading && <p className="text-slate-400 text-sm" data-testid="ai-drafts-loading">{DRAFTS_LOADING}</p>}

            {!loading && drafts.length === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center bg-white/50" data-testid="ai-drafts-empty">
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-300 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Receipt size={32} />
                    </div>
                    <h3 className="font-bold text-slate-500 text-lg">{DRAFTS_EMPTY_TITLE}</h3>
                    <p className="text-sm text-slate-500 mt-1">{DRAFTS_EMPTY_LINE}</p>
                </div>
            )}

            <div className="space-y-3">
                {drafts.map(job => (
                    <div key={job.id} className="glass-panel p-4 rounded-2xl flex items-start justify-between gap-3" data-testid={`ai-draft-row-${job.id}`}>
                        <div className="flex items-start gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                                <Receipt size={18} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-400">{formatRecordedAt(resolveRecordedInstant(job))}</p>
                                <p className="text-sm text-slate-700 line-clamp-2">{previewLabel(job)}</p>
                                {/* A row with only a Discard affordance and no explanation reads as a dead end: say plainly that it
                                    cannot be opened here yet, and that it is kept, not lost, if he does nothing. */}
                                <p className="text-xs text-amber-700 mt-1" data-testid={`ai-draft-not-openable-${job.id}`}>{DRAFTS_NOT_OPENABLE}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleDiscard(job)}
                            disabled={busyJobId === job.id}
                            className="shrink-0 p-2 rounded-lg bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-600 disabled:opacity-50"
                            title={DRAFTS_DISCARD}
                            aria-label={DRAFTS_DISCARD}
                            data-testid={`ai-draft-discard-${job.id}`}
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AiDraftsPage;
