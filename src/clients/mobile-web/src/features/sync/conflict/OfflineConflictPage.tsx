/**
 * Sub-plan 04 Task 5 — OfflineConflictPage.
 *
 * Lists every mutation the server rejected and offers retry/discard per
 * row. Marathi-first copy with English subtitles for low-literacy users.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { ConflictResolutionService, type RejectedMutationView } from './ConflictResolutionService';

interface OfflineConflictPageProps {
    onBack?: () => void;
}

const OfflineConflictPage: React.FC<OfflineConflictPageProps> = ({ onBack }) => {
    const [items, setItems] = useState<RejectedMutationView[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const fresh = await ConflictResolutionService.list();
            setItems(fresh);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setItems([]);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleRetry = async (mutationId: string) => {
        setBusyId(mutationId);
        try {
            await ConflictResolutionService.retry(mutationId);
            setItems(prev => prev ? prev.filter(i => i.mutationId !== mutationId) : prev);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyId(null);
        }
    };

    const handleEdit = async (mutationId: string) => {
        setBusyId(mutationId);
        try {
            await ConflictResolutionService.edit(mutationId);
            // Optimistically remove the row — the user is being routed away
            // to the edit surface; on submit, MutationQueue.replacePayload
            // resets the row to PENDING and the worker picks it up. If the
            // user backs out without submitting, refresh() on next mount
            // restores the row.
            setItems(prev => prev ? prev.filter(i => i.mutationId !== mutationId) : prev);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyId(null);
        }
    };

    const handleDiscard = async (mutationId: string) => {
        setBusyId(mutationId);
        try {
            await ConflictResolutionService.discard(mutationId);
            setItems(prev => prev ? prev.filter(i => i.mutationId !== mutationId) : prev);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyId(null);
        }
    };

    if (items === null) {
        return (
            <div className="p-4 text-center text-slate-500" data-testid="conflict-loading">
                लोड होत आहे… (Loading…)
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="p-4 text-center" data-testid="conflict-empty">
                {onBack && (
                    <button type="button" onClick={onBack} className="text-sm text-emerald-700 mb-3" data-testid="conflict-back">
                        ← Back
                    </button>
                )}
                <h2 className="font-headings text-xl">सर्व नोंदी सिंक झाल्या आहेत.</h2>
                <p className="text-sm text-slate-500">No conflicts to resolve.</p>
            </div>
        );
    }

    return (
        <div className="p-4 space-y-3" data-testid="conflict-list">
            {onBack && (
                <button type="button" onClick={onBack} className="text-sm text-emerald-700" data-testid="conflict-back">
                    ← Back
                </button>
            )}
            <header>
                <h2 className="font-headings text-xl">सिंक न झालेल्या नोंदी ({items.length})</h2>
                <p className="text-sm text-slate-500">{items.length} mutation{items.length === 1 ? '' : 's'} need your attention.</p>
            </header>
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
                            {new Date(item.capturedAt).toLocaleString()}
                        </span>
                    </header>
                    <p className="mt-2 text-sm">
                        <strong>{item.reason}</strong>
                        {item.hint ? <> — {item.hint}</> : null}
                    </p>
                    <pre className="mt-2 max-h-24 overflow-hidden text-xs bg-white p-2 rounded">
                        {item.payloadPreview}
                    </pre>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => handleEdit(item.mutationId)}
                            disabled={busyId === item.mutationId}
                            className="rounded bg-amber-600 px-3 py-1 text-white disabled:opacity-50"
                            data-testid={`edit-${item.mutationId}`}
                        >
                            बदल करा (Edit)
                        </button>
                        <button
                            type="button"
                            onClick={() => handleRetry(item.mutationId)}
                            disabled={busyId === item.mutationId}
                            className="rounded bg-emerald-600 px-3 py-1 text-white disabled:opacity-50"
                            data-testid={`retry-${item.mutationId}`}
                        >
                            पुन्हा प्रयत्न करा (Retry)
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDiscard(item.mutationId)}
                            disabled={busyId === item.mutationId}
                            className="rounded bg-rose-600 px-3 py-1 text-white disabled:opacity-50"
                            data-testid={`discard-${item.mutationId}`}
                        >
                            काढून टाका (Discard)
                        </button>
                    </div>
                </article>
            ))}
        </div>
    );
};

export default OfflineConflictPage;
