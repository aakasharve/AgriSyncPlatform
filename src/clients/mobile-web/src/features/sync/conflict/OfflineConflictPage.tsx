/**
 * Sub-plan 04 Task 5 — OfflineConflictPage.
 *
 * Lists every mutation the server rejected and offers retry/discard per
 * row.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H19 / PLR-D9 T1-T2) — the one title bar with
 * one big मागे (it was an English "← Back"), and the English copies printed beside or under the Marathi
 * words ("(Loading…)", "No conflicts to resolve.", "(Retry)", "(Discard)") are gone.
 *
 * NOT yet plain Marathi: each row still shows technical content to the farmer — the raw mutation name,
 * the server's reason text and a JSON preview of what was sent. Turning those into words he can read
 * needs a name for every kind of record and is outside this change (noted for the founder).
 *
 * P4 — a list that could not be READ is not "all synced": that line is shown only when the list was
 * read and is empty. A failed read says so instead.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { ConflictResolutionService, type RejectedMutationView } from './ConflictResolutionService';
import { formatDisplayTimestamp } from '../../../shared/utils/displayTime';
import { PageBar } from '../../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

/** The page's own heading words, now its title. */
const CONFLICTS_TITLE = 'सिंक न झालेल्या नोंदी';
// PROPOSED (Marathi): the list could not be read (not the same as "nothing is waiting").
const CONFLICTS_READ_FAILED = 'या नोंदी आत्ता उघडता आल्या नाहीत. थोड्या वेळाने पुन्हा उघडा.';
// PROPOSED (Marathi): a retry / discard that did not go through (nothing changed, so trying again is honest).
const CONFLICTS_ACTION_FAILED = 'हे झालं नाही. पुन्हा प्रयत्न करा.';

interface OfflineConflictPageProps {
    onBack?: () => void;
}

const OfflineConflictPage: React.FC<OfflineConflictPageProps> = ({ onBack }) => {
    const [items, setItems] = useState<RejectedMutationView[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [readFailed, setReadFailed] = useState(false);
    const language = useOptionalLanguage()?.language;

    const refresh = useCallback(async () => {
        try {
            // Lane OF-S fix 1 (B011): the plain reasons come in his language.
            const fresh = await ConflictResolutionService.list(language);
            setItems(fresh);
            setError(null);
            setReadFailed(false);
        } catch {
            // P4: not "all synced" — we do not know. Say the list could not be opened.
            setReadFailed(true);
            setItems([]);
        }
    }, [language]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleRetry = async (mutationId: string) => {
        setBusyId(mutationId);
        try {
            await ConflictResolutionService.retry(mutationId);
            setItems(prev => prev ? prev.filter(i => i.mutationId !== mutationId) : prev);
        } catch {
            setError(CONFLICTS_ACTION_FAILED);
        } finally {
            setBusyId(null);
        }
    };

    const handleDiscard = async (mutationId: string) => {
        setBusyId(mutationId);
        try {
            await ConflictResolutionService.discard(mutationId);
            setItems(prev => prev ? prev.filter(i => i.mutationId !== mutationId) : prev);
        } catch {
            setError(CONFLICTS_ACTION_FAILED);
        } finally {
            setBusyId(null);
        }
    };

    if (items === null) {
        return (
            <div data-testid="conflict-loading">
                <PageBar title={CONFLICTS_TITLE} onBack={onBack} />
                <p className="p-4 text-center text-slate-500">लोड होत आहे…</p>
            </div>
        );
    }

    if (readFailed) {
        return (
            <div data-testid="conflict-read-failed">
                <PageBar title={CONFLICTS_TITLE} onBack={onBack} />
                <p className="p-4 text-center text-rose-700" role="alert">{CONFLICTS_READ_FAILED}</p>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div data-testid="conflict-empty">
                <PageBar title={CONFLICTS_TITLE} onBack={onBack} />
                <h2 className="p-4 text-center font-headings text-xl">सर्व नोंदी सिंक झाल्या आहेत.</h2>
            </div>
        );
    }

    return (
        <div className="space-y-3 pb-4" data-testid="conflict-list">
            <PageBar title={`${CONFLICTS_TITLE} (${items.length})`} onBack={onBack} />
            {error && (
                <div className="rounded bg-rose-50 p-2 text-sm text-rose-700" data-testid="conflict-error" role="alert">
                    {error}
                </div>
            )}
            {items.map(item => (
                <article
                    key={item.mutationId}
                    className="rounded-lg border border-amber-300 bg-amber-50 p-3"
                    data-testid={`conflict-row-${item.mutationId}`}
                >
                    <header className="flex items-center justify-between">
                        <span className="font-mono text-xs text-slate-500">{item.mutationType}</span>
                        <span className="text-xs text-slate-400">
                            {formatDisplayTimestamp(item.capturedAt)}
                        </span>
                    </header>
                    <p className="mt-2 text-sm">
                        <strong>{item.reason}</strong>
                        {item.hint ? <> — {item.hint}</> : null}
                    </p>
                    <pre className="mt-2 max-h-24 overflow-hidden text-xs bg-white p-2 rounded">
                        {item.payloadPreview}
                    </pre>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            onClick={() => handleRetry(item.mutationId)}
                            disabled={busyId === item.mutationId}
                            className="rounded bg-emerald-600 px-3 py-1 text-white disabled:opacity-50"
                            data-testid={`retry-${item.mutationId}`}
                        >
                            पुन्हा प्रयत्न करा
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDiscard(item.mutationId)}
                            disabled={busyId === item.mutationId}
                            className="rounded bg-rose-600 px-3 py-1 text-white disabled:opacity-50"
                            data-testid={`discard-${item.mutationId}`}
                        >
                            काढून टाका
                        </button>
                    </div>
                </article>
            ))}
        </div>
    );
};

export default OfflineConflictPage;
