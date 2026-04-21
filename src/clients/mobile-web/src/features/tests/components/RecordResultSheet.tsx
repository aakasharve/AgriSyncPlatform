/**
 * RecordResultSheet — CEI Phase 2 §4.5 task 4.2.2.
 *
 * Flow:
 *   1. Render one row per parameter code from the attached protocol.
 *   2. Allow the lab operator to attach a PDF (reuses captureAttachment).
 *   3. Inline warning is shown until ≥1 attachment is present.
 *   4. Save button is disabled until every parameter has a numeric value
 *      AND there is at least one attachment.
 *   5. On success, the server returns a list of recommendations; surface
 *      them as a success toast with an "Add to plan" action handled by
 *      the parent (TestQueuePage refetches, TestDetailPage offers per-rec
 *      plan buttons).
 */

import React, { useMemo, useState } from 'react';
import { X, ClipboardList, Paperclip, CheckCircle } from 'lucide-react';
import type { DexieTestInstance, DexieTestProtocol } from '../../../infrastructure/storage/DexieDatabase';
import { useFarmContext } from '../../../core/session/FarmContext';
import { captureAttachment } from '../../../application/use-cases/CaptureAttachment';
import { recordResult, type ResultInput, type RecordTestResultResponse } from '../data/testsClient';

interface RecordResultSheetProps {
    instance: DexieTestInstance;
    protocol?: DexieTestProtocol;
    onClose: () => void;
    onSuccess: (response: RecordTestResultResponse) => void;
}

interface Row {
    parameterCode: string;
    value: string;
    unit: string;
}

const RecordResultSheet: React.FC<RecordResultSheetProps> = ({ instance, protocol, onClose, onSuccess }) => {
    const { currentFarmId } = useFarmContext();
    const paramCodes = useMemo(() => protocol?.parameterCodes ?? [], [protocol]);

    const [rows, setRows] = useState<Row[]>(() =>
        paramCodes.length > 0
            ? paramCodes.map(code => ({ parameterCode: code, value: '', unit: '' }))
            : [{ parameterCode: '', value: '', unit: '' }],
    );
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isAttaching, setIsAttaching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successRecs, setSuccessRecs] = useState<RecordTestResultResponse | null>(null);

    const allFilled = rows.length > 0 && rows.every(r => r.value.trim() !== '' && r.parameterCode.trim() !== '');
    const canSave = allFilled && attachmentIds.length > 0 && !isSaving;

    const updateRow = (i: number, patch: Partial<Row>) => {
        setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    };

    const handleAttach = async () => {
        if (!currentFarmId || isAttaching) return;
        setIsAttaching(true);
        setError(null);
        try {
            const record = await captureAttachment({
                source: 'file',
                farmId: currentFarmId,
                linkedEntityId: instance.id,
                linkedEntityType: 'TestInstance',
            });
            setAttachmentIds(prev => (prev.includes(record.id) ? prev : [...prev, record.id]));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not attach file.');
        } finally {
            setIsAttaching(false);
        }
    };

    const handleSave = async () => {
        if (!canSave) return;
        setIsSaving(true);
        setError(null);
        try {
            const results: ResultInput[] = rows.map(r => ({
                parameterCode: r.parameterCode.trim(),
                parameterValue: r.value.trim(),
                unit: r.unit.trim(),
            }));
            const response = await recordResult(instance.id, results, attachmentIds);
            setSuccessRecs(response);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save results. Try again.');
            setIsSaving(false);
        }
    };

    const handleDismissSuccess = () => {
        if (successRecs) onSuccess(successRecs);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
            onClick={isSaving ? undefined : onClose}
        >
            <div
                className="w-full max-w-lg rounded-t-[2rem] bg-white px-6 pb-6 pt-6 shadow-2xl sm:rounded-3xl max-h-[92vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                        <ClipboardList size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-lg font-bold text-stone-900"
                        >
                            Record lab result
                        </h3>
                        <p
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-sm font-semibold text-stone-500"
                        >
                            लॅब निकाल नोंदवा
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 disabled:opacity-50"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {successRecs ? (
                    <SuccessPanel response={successRecs} onDismiss={handleDismissSuccess} />
                ) : (
                    <>
                        {/* Instance summary */}
                        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                            <p
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                className="text-base font-bold text-stone-900 truncate"
                            >
                                {instance.testProtocolName ?? protocol?.name ?? 'Test'}
                            </p>
                            <p
                                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                className="text-xs text-stone-500"
                            >
                                {instance.stageName} · {instance.plannedDueDate}
                            </p>
                        </div>

                        {/* Parameter rows */}
                        <div className="mt-4 space-y-2">
                            <p
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                className="text-[10px] font-bold uppercase tracking-widest text-stone-400"
                            >
                                Parameters
                            </p>
                            {rows.map((row, i) => (
                                <div key={`${row.parameterCode}-${i}`} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
                                    <input
                                        type="text"
                                        value={row.parameterCode}
                                        onChange={e => updateRow(i, { parameterCode: e.target.value })}
                                        placeholder="Code"
                                        className="w-20 text-sm font-semibold text-stone-800 bg-transparent outline-none placeholder:text-stone-300"
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        readOnly={paramCodes.length > 0}
                                    />
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={row.value}
                                        onChange={e => updateRow(i, { value: e.target.value })}
                                        placeholder="Value"
                                        className="flex-1 text-sm font-semibold text-stone-800 bg-transparent outline-none placeholder:text-stone-300"
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                    />
                                    <input
                                        type="text"
                                        value={row.unit}
                                        onChange={e => updateRow(i, { unit: e.target.value })}
                                        placeholder="Unit"
                                        className="w-20 text-xs text-stone-500 bg-transparent outline-none placeholder:text-stone-300"
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Attach button + warning */}
                        <div className="mt-4">
                            <button
                                type="button"
                                onClick={handleAttach}
                                disabled={isAttaching || !currentFarmId}
                                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700 hover:border-stone-300 disabled:opacity-50"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                <Paperclip size={16} />
                                {isAttaching ? 'Attaching…' : `Attach lab PDF${attachmentIds.length > 0 ? ` (${attachmentIds.length})` : ''}`}
                            </button>

                            {attachmentIds.length === 0 && (
                                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                                    <p
                                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                        className="text-xs font-semibold text-amber-900"
                                    >
                                        निकाल जतन करण्यासाठी लॅब रिपोर्ट PDF जोडा.
                                    </p>
                                    <p
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        className="text-[11px] text-amber-800 mt-0.5"
                                    >
                                        Attach the lab report PDF to save the result.
                                    </p>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                                {error}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="mt-5 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSaving}
                                className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700 hover:border-stone-300 disabled:opacity-50"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!canSave}
                                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm active:bg-emerald-700 disabled:bg-stone-200 disabled:text-stone-400"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {isSaving ? 'Saving…' : 'Save result'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const SuccessPanel: React.FC<{ response: RecordTestResultResponse; onDismiss: () => void }> = ({ response, onDismiss }) => (
    <div className="mt-4">
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
            <CheckCircle size={18} className="text-emerald-600" />
            <p
                style={{ fontFamily: "'DM Sans', sans-serif" }}
                className="text-sm font-bold text-emerald-800"
            >
                Result saved
            </p>
        </div>

        {response.recommendations.length > 0 ? (
            <div className="mt-3">
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2"
                >
                    Recommendations ({response.recommendations.length})
                </p>
                <ul className="space-y-2">
                    {response.recommendations.map(rec => (
                        <li key={rec.id} className="rounded-2xl border border-stone-200 bg-white p-3">
                            <p
                                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                className="text-sm font-semibold text-stone-800"
                            >
                                {rec.titleMr}
                            </p>
                            <p
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                className="text-xs text-stone-500 mt-0.5"
                            >
                                {rec.titleEn}
                            </p>
                        </li>
                    ))}
                </ul>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-[11px] text-stone-400 mt-2"
                >
                    Open the test detail page to add these to your plan.
                </p>
            </div>
        ) : (
            <p
                style={{ fontFamily: "'DM Sans', sans-serif" }}
                className="text-xs text-stone-500 mt-3"
            >
                No new recommendations for this result.
            </p>
        )}

        <button
            type="button"
            onClick={onDismiss}
            className="mt-5 w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-bold text-white shadow-sm active:bg-stone-800"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
            Done
        </button>
    </div>
);

export default RecordResultSheet;
