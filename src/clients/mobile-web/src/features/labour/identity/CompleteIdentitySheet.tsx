/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 section 10). "यांचा फोन व पिन भरा" for ONE
 * worker already on the team: his phone (tagged) and his home PIN, the same three fields as the add form, saved on the
 * server only. "नंतर करा" always closes it; nothing here ever holds up हजेरी or a log.
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { FieldOperator } from '../data/fieldOperatorClient';
import { recordContact } from '../data/workerIdentityClient';
import { EMPTY_IDENTITY, IdentityFields, readIdentity, type IdentityValue, type SharedCheck } from './IdentityFields';
import { widText } from './widCopy';

interface Props {
    farmId: string;
    worker: FieldOperator;
    farmPinCode?: string | null;
    onCheckPhone?: (phone: string) => Promise<SharedCheck | null>;
    onSaved: (worker: FieldOperator) => void;
    onCancel: () => void;
}

export const CompleteIdentitySheet: React.FC<Props> = ({ farmId, worker, farmPinCode, onCheckPhone, onSaved, onCancel }) => {
    const language = useOptionalLanguage()?.language;
    const [value, setValue] = useState<IdentityValue>({
        ...EMPTY_IDENTITY,
        whose: (worker.phoneWhose as IdentityValue['whose'] | undefined) ?? 'Own',
        pin: worker.homePin ?? '',
    });
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    useBackDismiss(true, onCancel);
    const ready = readIdentity(value);

    const save = async () => {
        if (!ready || busy) return;
        setBusy(true);
        setFailed(false);
        try {
            const view = await recordContact(farmId, worker.id, { phone: ready.phone, phoneWhose: ready.phoneWhose, homePin: ready.homePin });
            onSaved({
                ...worker,
                ...(view.cardCode ? { cardCode: view.cardCode } : {}),
                identityLevel: view.identityLevel,
                needsPhoneAndPin: view.needsPhoneAndPin,
                phoneWhose: view.phoneWhose ?? undefined,
                phoneTail: view.phoneTail ?? undefined,
                homePin: view.homePin ?? undefined,
            });
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60 p-3 backdrop-blur-sm sm:items-center" onClick={onCancel}>
            <div data-testid="complete-identity" className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[17px] font-extrabold text-stone-800">{worker.displayName} · {widText('completeTitle', language)}</h3>
                    <button type="button" onClick={onCancel} aria-label={widText('close', language)} className="rounded-full p-2 hover:bg-stone-100">
                        <X size={20} className="text-stone-500" />
                    </button>
                </div>
                <IdentityFields value={value} onChange={setValue} farmPinCode={farmPinCode} language={language} disabled={busy} onCheckPhone={onCheckPhone} />
                {failed && <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13.5px] font-semibold text-amber-800">{widText('failed', language)}</p>}
                <div className="mt-4 flex gap-2">
                    <button type="button" data-testid="complete-save" disabled={!ready || busy} onClick={() => void save()}
                        className="min-h-[52px] flex-1 rounded-2xl bg-emerald-600 text-[16px] font-extrabold text-white disabled:opacity-50">
                        {widText('save', language)}
                    </button>
                    <button type="button" onClick={onCancel} className="min-h-[52px] flex-1 rounded-2xl border border-stone-200 text-[15px] font-bold text-stone-600">
                        {widText('later', language)}
                    </button>
                </div>
            </div>
        </div>
    );
};
