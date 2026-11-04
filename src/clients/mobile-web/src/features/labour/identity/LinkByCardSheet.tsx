/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 screen 5). "कोड किंवा QR ने जोडा": a worker
 * already on ShramSafal joins THIS farm's team as the same person. R1 — never on a name, never on a number alone:
 *   - by his CARD (scanned or its code typed): the scan shows only the name on the card and its level (R6); when he has
 *     a verified phone a code goes to it and he reads it out (his consent); with no verified phone, his card shown in
 *     person is the proof;
 *   - by his VERIFIED NUMBER: a code goes to that phone; nobody is named until the code comes back (case 11).
 * Nothing is linked until the owner sees who it is and taps "तोच माणूस — जोडा". This farm never sees his work or pay on
 * any other farm.
 */
import React, { useRef, useState } from 'react';
import { Phone, ShieldCheck, X } from 'lucide-react';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { identityLevelIn } from '../../../shared/names/namesIn';
import type { FieldOperator } from '../data/fieldOperatorClient';
import { identityErrorCode, linkWorker, resolveCard, startLink } from '../data/workerIdentityClient';
import { CardScanner } from './CardScanner';
import { normalizeIndianMobile } from './cardCode';
import { widText, type WidWord } from './widCopy';

interface Props {
    farmId: string;
    onLinked: (worker: FieldOperator) => void;
    onCancel: () => void;
}

interface Found {
    cardCode?: string;
    name: string | null;
    level: string | null;
    ticket: string | null;
}

const ERRORS: Record<string, WidWord> = {
    'identity.not_found': 'cardUnknown',
    'identity.card_retired': 'cardRetired',
    'identity.code_wrong': 'codeWrong',
    'identity.code_expired': 'codeExpired',
    'identity.proof_needed': 'codeWrong',
    'identity.already_on_team': 'alreadyOnTeam',
    'identity.sms_off': 'smsOff',
    'identity.too_many_codes': 'tooMany',
};

export const LinkByCardSheet: React.FC<Props> = ({ farmId, onLinked, onCancel }) => {
    const language = useOptionalLanguage()?.language;
    const [found, setFound] = useState<Found | null>(null);
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const clientIdRef = useRef(idGenerator.generate());
    useBackDismiss(true, onCancel);

    const say = (error: unknown) => setNote(widText(ERRORS[identityErrorCode(error) ?? ''] ?? 'failed', language));

    const byCard = async (body: string) => {
        if (busy) return;
        setBusy(true);
        setNote(null);
        try {
            const card = await resolveCard(farmId, body);
            if (card.status !== 'Active') {
                setNote(widText('cardRetired', language));
                return;
            }
            // A verified phone means his consent is a code on it (sent now, as screen 5 shows); otherwise his card is proof.
            const started = card.level === 'PhoneVerified' ? await startLink(farmId, { cardCode: body }) : null;
            setFound({ cardCode: body, name: card.displayName, level: card.level, ticket: started?.ticket ?? null });
            setCode('');
        } catch (error) {
            say(error);
        } finally {
            setBusy(false);
        }
    };

    const byNumber = async () => {
        const digits = normalizeIndianMobile(phone);
        if (!digits || busy) return;
        setBusy(true);
        setNote(null);
        try {
            const started = await startLink(farmId, { phone: digits });
            setFound({ name: null, level: null, ticket: started.ticket });
            setCode('');
        } catch (error) {
            say(error);
        } finally {
            setBusy(false);
        }
    };

    const confirm = async () => {
        if (!found || busy || (found.ticket && code.length !== 4)) return;
        setBusy(true);
        setNote(null);
        try {
            const view = await linkWorker(farmId, {
                ...(found.cardCode ? { cardCode: found.cardCode } : {}),
                ...(found.ticket ? { ticket: found.ticket, code } : {}),
                id: clientIdRef.current,
            });
            onLinked({
                id: view.fieldOperatorId,
                displayName: view.displayName,
                isActive: true,
                ...(view.cardCode ? { cardCode: view.cardCode } : {}),
                identityLevel: view.identityLevel,
                needsPhoneAndPin: view.needsPhoneAndPin,
            });
        } catch (error) {
            say(error);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60 p-3 backdrop-blur-sm sm:items-center" onClick={onCancel}>
            <div data-testid="link-by-card" className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[17px] font-extrabold text-stone-800">{widText('byCard', language)}</h3>
                    <button type="button" onClick={onCancel} aria-label={widText('close', language)} className="rounded-full p-2 hover:bg-stone-100">
                        <X size={20} className="text-stone-500" />
                    </button>
                </div>

                {!found ? (
                    <>
                        <p className="mb-3 text-[14px] font-semibold text-stone-600">{widText('linkTitle', language)} {widText('linkHint', language)}</p>
                        <CardScanner onCode={(body) => void byCard(body)} onCancel={onCancel} paused={busy} />
                        <div className="mt-4 border-t border-stone-100 pt-3">
                            <label htmlFor="link-phone" className="mb-1.5 ml-1 flex items-center gap-1.5 text-[13px] font-extrabold text-stone-500">
                                <Phone size={14} aria-hidden /> {widText('phoneLabel', language)}
                            </label>
                            <div className="flex gap-2">
                                <input id="link-phone" data-testid="link-phone" inputMode="tel" maxLength={16} value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="min-h-[52px] flex-1 rounded-xl border border-stone-200 px-3 text-[18px] font-bold" />
                                <button type="button" data-testid="link-phone-submit" disabled={busy || !normalizeIndianMobile(phone)} onClick={() => void byNumber()}
                                    className="min-h-[52px] rounded-xl bg-emerald-600 px-4 text-[16px] font-extrabold text-white disabled:opacity-50">
                                    {widText('find', language)}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="space-y-3">
                        {found.name && (
                            <div className="flex items-center gap-3 rounded-2xl border border-stone-200 p-3">
                                <span className="grid h-11 w-11 place-items-center rounded-full bg-stone-200 text-[18px] font-extrabold text-stone-700">{found.name.trim().slice(0, 1)}</span>
                                <span className="min-w-0 flex-1">
                                    <span data-testid="link-found-name" className="block text-[17px] font-extrabold text-stone-800">{found.name}</span>
                                    {found.cardCode && <span className="block font-mono text-[12.5px] text-stone-500">SS-{found.cardCode.slice(0, 4)}-{found.cardCode.slice(4)}</span>}
                                </span>
                                {found.level && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[12.5px] font-extrabold text-emerald-700">
                                        <ShieldCheck size={13} aria-hidden /> {identityLevelIn(found.level, language)}
                                    </span>
                                )}
                            </div>
                        )}
                        {found.ticket && (
                            <div>
                                <p className="text-[14px] font-bold text-stone-700">
                                    {widText('linkCodeSent', language, { name: found.name ?? '' })}
                                </p>
                                <input data-testid="link-code" inputMode="numeric" maxLength={4} value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                    className="mt-2 min-h-[56px] w-full rounded-xl border-2 border-stone-300 text-center font-mono text-[28px] font-extrabold tracking-[0.5em] focus:border-emerald-500 focus:outline-none" />
                            </div>
                        )}
                        <button type="button" data-testid="link-confirm" disabled={busy || Boolean(found.ticket && code.length !== 4)} onClick={() => void confirm()}
                            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-[16px] font-extrabold text-white disabled:opacity-50">
                            <ShieldCheck size={18} aria-hidden /> {widText('sameMan', language)}
                        </button>
                        <p className="rounded-xl bg-blue-50 p-3 text-[13px] font-semibold text-blue-900">{widText('otherFarmsHidden', language)}</p>
                        <button type="button" onClick={() => { setFound(null); setNote(null); }} className="min-h-[44px] w-full text-[14px] font-bold text-stone-500">
                            {widText('later', language)}
                        </button>
                    </div>
                )}

                {note && <p role="status" data-testid="link-note" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13.5px] font-semibold text-amber-800">{note}</p>}
            </div>
        </div>
    );
};
