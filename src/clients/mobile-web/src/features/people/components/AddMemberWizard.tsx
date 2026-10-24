/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AddMemberWizard - "add a worker's NAME" to the farm (Team page).
 *
 * This used to be a local-only wizard (English "Partner" / "Worker", a phone-local profile edit,
 * four permission switches that gated nothing). It is now one honest form that adds a NAMED WORKER
 * on the SERVER: a name on the farm, no login, no ownership, no subscription. Giving a person an app
 * login is the farm QR - this form says so rather than pretending to do it.
 *
 * The caller owns the network call (`onAdd`) and answers with the server's verdict; this form
 * shows a failure inside itself, keeps what was typed, and closes only on a server-accepted add.
 * The id of the person being added is created once when the form opens and REUSED on every retry, so
 * a retry after a lost response cannot create a second copy.
 */
import React, { useRef, useState } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import type { WorkerActionFailure, WorkerActionResult } from '../../profile/hooks/useFarmWorkers';

export const ADD_WORKER_FAILURE_COPY: Record<WorkerActionFailure, string> = {
    offline: 'इंटरनेट नसल्यामुळे आत्ता नाव जोडता आलं नाही — नेट आल्यावर पुन्हा जोडा.',
    refused: 'हे तुम्हाला करता येत नाही.',
    failed: 'नाव जोडता आलं नाही — पुन्हा प्रयत्न करा',
};

interface AddMemberWizardProps {
    onAdd: (displayName: string, fullName: string | undefined, clientId: string) => Promise<WorkerActionResult>;
    /** Called once, after the SERVER accepted the add. */
    onAdded: (displayName: string) => void;
    onCancel: () => void;
    /** The list could not be read: adding is held so a name is not added blind (a second बाळू). */
    blocked?: boolean;
}

export const AddMemberWizard: React.FC<AddMemberWizardProps> = ({ onAdd, onAdded, onCancel, blocked }) => {
    const [name, setName] = useState('');
    const [fullName, setFullName] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<WorkerActionFailure | null>(null);
    const clientIdRef = useRef<string>(idGenerator.generate());

    const canSave = name.trim().length > 0 && !busy && !blocked;

    const handleSave = async () => {
        if (!canSave) return;
        setBusy(true);
        setFailure(null);
        const result = await onAdd(name.trim(), fullName.trim() || undefined, clientIdRef.current);
        setBusy(false);
        if (result.ok) {
            onAdded(result.worker.displayName);
        } else {
            setFailure(result.reason);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-100 max-h-[85vh]">
                <div className="bg-slate-50/90 p-4 border-b border-slate-100 flex items-center justify-between backdrop-blur-md shrink-0">
                    <h3 className="font-bold text-slate-800 text-lg">कामगाराचं नाव जोडा</h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label="बंद करा"
                        className="p-2 hover:bg-slate-200/50 rounded-full transition-colors"
                    >
                        <X size={20} className="text-slate-500" />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    <p className="text-[13px] leading-snug text-slate-500">
                        हे फक्त नाव आहे — यांना अ‍ॅपमध्ये लॉगिन मिळत नाही. लॉगिनसाठी शेताचा QR दाखवा.
                    </p>

                    <div>
                        <label htmlFor="add-worker-name" className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">नवीन नाव</label>
                        <input
                            id="add-worker-name"
                            autoFocus
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 border-0 rounded-xl font-bold text-lg outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 placeholder:text-slate-300 transition-all focus:bg-white"
                            placeholder="नाव"
                            aria-label="नवीन माणसाचं नाव"
                        />
                    </div>
                    <div>
                        <input
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 border-0 rounded-xl font-medium text-base outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 placeholder:text-slate-300 transition-all focus:bg-white"
                            placeholder="पूर्ण नाव किंवा ओळख — हवं तर"
                            aria-label="पूर्ण नाव किंवा ओळख — ऐच्छिक"
                        />
                    </div>

                    {blocked && (
                        <p role="status" className="text-[13px] leading-snug text-amber-700">
                            यादी आली नाही, म्हणून नवीन नाव आत्ता जोडता येणार नाही — आधी पुन्हा प्रयत्न करा.
                        </p>
                    )}
                    {failure && (
                        <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
                            {ADD_WORKER_FAILURE_COPY[failure]}
                        </p>
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={!canSave}
                        aria-busy={busy}
                        className={`w-full py-3.5 rounded-xl text-sm font-bold shadow-lg shadow-emerald-200/50 flex items-center justify-center gap-2 transform active:scale-[0.98] transition-all ${canSave ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'}`}
                    >
                        जोडा <ChevronRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};
