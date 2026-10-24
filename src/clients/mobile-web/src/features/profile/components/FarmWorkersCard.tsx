/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FarmWorkersCard - the farm's NAMED WORKERS on the Team page, with Add and Remove that are REAL.
 *
 * Named worker = a name on the farm with no login (a field operator). Not a linked app user (that
 * is the farm QR) and not a subscription. Shown to owner / co-owner only (the page decides); the
 * server enforces the same write rule on every call and is the final word.
 *
 * Follows server truth: a row appears only after the server accepted the add; a row leaves only after
 * the server retired it. Remove RETIRES (he is no longer offered for new marks); his past attendance,
 * money and the name on them stay, so the confirmation says exactly that.
 */
import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { useFarmWorkers, type WorkerActionFailure } from '../hooks/useFarmWorkers';
import { AddMemberWizard } from '../../people/components/AddMemberWizard';
import { buildPickerRows, toneForOperatorId } from '../../labour/components/FieldOperatorPicker';
import { Avatar, EmptyState, LoadErrorBanner, LoadingState } from '../../labour/components/LabourUiKit';

const REMOVE_FAILURE_COPY: Record<WorkerActionFailure, string> = {
    offline: 'इंटरनेट नसल्यामुळे आत्ता काढता आलं नाही.',
    refused: 'हे तुम्हाला करता येत नाही.',
    failed: 'काढता आलं नाही — पुन्हा प्रयत्न करा',
};

interface FarmWorkersCardProps {
    farmId: string;
}

export const FarmWorkersCard: React.FC<FarmWorkersCardProps> = ({ farmId }) => {
    const farm = useFarmWorkers(farmId);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    const rows = useMemo(() => buildPickerRows((farm.workers ?? []).filter((w) => w.isActive)), [farm.workers]);

    const handleRemove = async (id: string, name: string) => {
        setNotice(null);
        const result = await farm.remove(id);
        if (result.ok) {
            setConfirmId(null);
            setNotice({ kind: 'ok', text: `${name} ✓ काढलं` });
        } else {
            setNotice({ kind: 'error', text: REMOVE_FAILURE_COPY[result.reason] });
        }
    };

    return (
        <div data-testid="farm-workers-card" className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            {wizardOpen && (
                <AddMemberWizard
                    blocked={farm.loadFailed || farm.loading}
                    onAdd={farm.add}
                    onAdded={(name) => {
                        setWizardOpen(false);
                        setNotice({ kind: 'ok', text: `${name} ✓ जोडलं` });
                    }}
                    onCancel={() => setWizardOpen(false)}
                />
            )}

            <div className="mb-4">
                <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                    <Users size={20} className="text-emerald-600" />
                    कामगारांची नावं
                </h3>
                <p className="mt-1 text-xs text-slate-400">यांना अ‍ॅपमध्ये लॉगिन नाही — फक्त हजेरीसाठी नावं.</p>
            </div>

            <button
                type="button"
                onClick={() => { setNotice(null); setWizardOpen(true); }}
                className="mb-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 shadow-sm transition-all active:scale-95"
            >
                <Plus size={16} /> कामगाराचं नाव जोडा
            </button>

            {notice && (
                <p
                    role="status"
                    className={`mb-3 rounded-xl border px-3 py-2 text-xs font-semibold ${notice.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-100 bg-rose-50 text-rose-700'}`}
                >
                    {notice.text}
                </p>
            )}

            {farm.loading && farm.workers === null && <LoadingState label="नावांची यादी येत आहे…" compact />}
            {farm.loadFailed && <LoadErrorBanner onRetry={() => void farm.reload()} compact />}

            {!farm.loading && !farm.loadFailed && farm.workers !== null && rows.length === 0 && (
                <EmptyState
                    icon={<Users size={22} />}
                    title="अजून कुणाचं नाव नाही"
                    subtitle="वर नाव लिहून पहिलं नाव जोडा."
                />
            )}

            <div className="space-y-3">
                {rows.map((row) => {
                    const w = row.operator;
                    const confirming = confirmId === w.id;
                    const removing = farm.removingId === w.id;
                    return (
                        <div key={w.id} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                            <div className="flex items-center gap-3">
                                <Avatar tone={toneForOperatorId(w.id)} initial={w.displayName.trim().slice(0, 1)} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[15px] font-bold text-slate-800">
                                        {w.displayName}
                                        {row.tag && <span className="ml-2 rounded-lg bg-stone-100 px-2 py-0.5 text-[12px] font-bold text-stone-500">#{row.tag}</span>}
                                    </span>
                                    {row.fullName && <span className="block truncate text-xs text-slate-500">{row.fullName}</span>}
                                    {row.ambiguous && <span className="block text-xs text-slate-500">सारखं नाव — माणूस वेगळा</span>}
                                </span>
                                {!confirming && (
                                    <button
                                        type="button"
                                        data-testid={`remove-${w.id}`}
                                        aria-label={`${w.displayName} - काढा`}
                                        onClick={() => { setNotice(null); setConfirmId(w.id); }}
                                        className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-100 bg-white px-3 text-sm font-bold text-red-500 transition-all active:scale-95"
                                    >
                                        <Trash2 size={16} /> काढा
                                    </button>
                                )}
                            </div>

                            {confirming && (
                                <div data-testid={`remove-confirm-${w.id}`} className="mt-3 rounded-xl border border-red-100 bg-red-50/60 p-3">
                                    <p className="text-sm font-semibold text-slate-700">
                                        {w.displayName} ला यादीतून काढायचं? जुन्या हजेरीच्या नोंदी तशाच राहतील.
                                    </p>
                                    <div className="mt-3 flex gap-2">
                                        <button
                                            type="button"
                                            disabled={removing}
                                            aria-busy={removing}
                                            onClick={() => void handleRemove(w.id, w.displayName)}
                                            className="min-h-[44px] flex-1 rounded-xl bg-red-500 px-3 text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
                                        >
                                            काढा
                                        </button>
                                        <button
                                            type="button"
                                            disabled={removing}
                                            onClick={() => setConfirmId(null)}
                                            className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition-all active:scale-95 disabled:opacity-60"
                                        >
                                            नको
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default FarmWorkersCard;
