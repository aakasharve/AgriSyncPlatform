/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AddMemberWizard - "add a worker" to the farm (Team page).
 *
 * One honest form that adds a NAMED WORKER on the SERVER: a name on the farm, no login, no ownership, no subscription.
 * Giving a person an app login is the farm QR - this form says so rather than pretending to do it.
 *
 * lane WID (founder D-54 FINAL, section 10, screen 1): adding a named worker needs his NAME, his home PIN code (one tap on
 * "शेताचाच पिन" when the farm has a PIN on record) and a PHONE number tagged स्वतःचा / घरचा / मुकादमचा — "जोडा" stays
 * off until all three are right. The moment it is added he gets his ShramSafal card automatically. A number already on
 * this farm is one gentle question, never a block (R4). A worker already on ShramSafal is added by his card instead
 * ("कोड किंवा QR ने जोडा"). Work records never need any of it: the हजेरी screen's quick add and every log stay as they
 * were (P9).
 *
 * The caller owns the network call (`onAdd`) and answers with the server's verdict; this form shows a failure inside
 * itself, keeps what was typed, and closes only on a server-accepted add. The id of the person being added is created
 * once when the form opens and REUSED on every retry, so a retry after a lost response cannot create a second copy.
 */
import React, { useRef, useState } from 'react';
import { ChevronRight, QrCode, X } from 'lucide-react';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { WorkerActionFailure, WorkerActionResult } from '../../profile/hooks/useFarmWorkers';
import { EMPTY_IDENTITY, IdentityFields, readIdentity, type IdentityValue, type SharedCheck } from '../../labour/identity/IdentityFields';
import { widText } from '../../labour/identity/widCopy';
import type { NewWorkerIdentity } from '../../labour/data/fieldOperatorClient';

export const ADD_WORKER_FAILURE_COPY: Record<WorkerActionFailure, string> = {
    offline: 'इंटरनेट नसल्यामुळे आत्ता नाव जोडता आलं नाही — नेट आल्यावर पुन्हा जोडा.',
    refused: 'हे तुम्हाला करता येत नाही.',
    failed: 'नाव जोडता आलं नाही — पुन्हा प्रयत्न करा',
};

/** What the form sends: the name (and the line that tells him apart) with his phone, its tag and his PIN. */
export interface AddWorkerInput extends NewWorkerIdentity {
    displayName: string;
    fullName?: string;
}

interface AddMemberWizardProps {
    onAdd: (input: AddWorkerInput, clientId: string) => Promise<WorkerActionResult>;
    /** Called once, after the SERVER accepted the add. */
    onAdded: (displayName: string) => void;
    onCancel: () => void;
    /** The list could not be read: adding is held so a name is not added blind (a second बाळू). */
    blocked?: boolean;
    /** The farm's own PIN when on record (the one-tap chip); null/undefined = no chip, never guessed. */
    farmPinCode?: string | null;
    /** R4 — who on this farm already has the number (a question, never a block). */
    onCheckPhone?: (phone: string) => Promise<SharedCheck | null>;
    /** Opens "कोड किंवा QR ने जोडा" (the worker is already on ShramSafal). */
    onLinkByCard?: () => void;
}

export const AddMemberWizard: React.FC<AddMemberWizardProps> = ({
    onAdd, onAdded, onCancel, blocked, farmPinCode, onCheckPhone, onLinkByCard,
}) => {
    const language = useOptionalLanguage()?.language;
    const [name, setName] = useState('');
    const [fullName, setFullName] = useState('');
    const [identity, setIdentity] = useState<IdentityValue>(EMPTY_IDENTITY);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<WorkerActionFailure | null>(null);
    const clientIdRef = useRef<string>(idGenerator.generate());

    const ready = readIdentity(identity);
    const canSave = name.trim().length > 0 && ready !== null && !busy && !blocked;

    const handleSave = async () => {
        if (!canSave || !ready) return;
        setBusy(true);
        setFailure(null);
        const result = await onAdd({ displayName: name.trim(), fullName: fullName.trim() || undefined, ...ready }, clientIdRef.current);
        setBusy(false);
        if (result.ok) {
            onAdded(result.worker.displayName);
        } else {
            setFailure(result.reason);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-100 max-h-[90vh]">
                <div className="bg-slate-50/90 p-4 border-b border-slate-100 flex items-center justify-between backdrop-blur-md shrink-0">
                    <h3 className="font-bold text-slate-800 text-lg">{widText('addTitle', language)}</h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label={widText('close', language)}
                        className="p-2 hover:bg-slate-200/50 rounded-full transition-colors"
                    >
                        <X size={20} className="text-slate-500" />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    {onLinkByCard && (
                        <button type="button" data-testid="add-worker-by-card" onClick={onLinkByCard} disabled={blocked}
                            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 text-[15px] font-extrabold text-emerald-700 disabled:opacity-50">
                            <QrCode size={18} aria-hidden /> {widText('byCard', language)}
                        </button>
                    )}

                    <div>
                        <label htmlFor="add-worker-name" className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">{widText('name', language)} *</label>
                        <input
                            id="add-worker-name"
                            data-testid="add-worker-name"
                            autoFocus
                            value={name}
                            maxLength={200}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 border-0 rounded-xl font-bold text-lg outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 placeholder:text-slate-300 transition-all focus:bg-white"
                            placeholder={widText('name', language)}
                        />
                    </div>
                    <div>
                        <label htmlFor="add-worker-identify" className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">{widText('identify', language)}</label>
                        <input
                            id="add-worker-identify"
                            data-testid="add-worker-identify"
                            value={fullName}
                            maxLength={200}
                            onChange={e => setFullName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 border-0 rounded-xl font-medium text-base outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 placeholder:text-slate-300 transition-all focus:bg-white"
                        />
                        <p className="mt-1 ml-1 text-[12.5px] text-slate-500">{widText('identifyHint', language)}</p>
                    </div>

                    <IdentityFields value={identity} onChange={setIdentity} farmPinCode={farmPinCode} language={language}
                        disabled={busy} onCheckPhone={onCheckPhone} />

                    <p className="text-[12.5px] leading-snug text-slate-500">{widText('requiredNote', language)}</p>

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
                        data-testid="add-worker-submit"
                        onClick={() => void handleSave()}
                        disabled={!canSave}
                        aria-busy={busy}
                        className={`w-full py-3.5 rounded-xl text-sm font-bold shadow-lg shadow-emerald-200/50 flex items-center justify-center gap-2 transform active:scale-[0.98] transition-all ${canSave ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'}`}
                    >
                        {widText('add', language)} <ChevronRight size={16} />
                    </button>
                    <p className="mt-2 text-center text-[12px] text-slate-500">{widText('cardAuto', language)}</p>
                </div>
            </div>
        </div>
    );
};
