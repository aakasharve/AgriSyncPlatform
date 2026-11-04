/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 screens 2 and 3; orchestrator call 3).
 * A worker's ShramSafal card, made automatically when he was added:
 *   - the QR (holding ONLY https://shramsafal.in/w/<code>, R6), the code, and the three levels plainly (नाव → कार्ड →
 *     फोन पडताळलेला);
 *   - "WhatsApp वर पाठवा": the card PICTURE through the phone's own share sheet (the owner's WhatsApp); where the phone
 *     cannot share a picture, the card address as text; where it cannot share at all, the address is copied;
 *   - "छापा" where printing exists (a browser). The installed app has no print, so the button is not shown there (P5:
 *     never a control that does nothing) — the shared picture can go to any print app;
 *   - "फोन पडताळा": a 4-digit code to the number this farm entered; he reads it out (screen 3). Until the SMS template is
 *     approved, production says so calmly ("नंतर करा") — nothing pretends to be sent;
 *   - "नवीन कार्ड द्या" for a lost card (case 13): the old code stops working, the owner confirms him.
 * Everything here is ONLINE: a failure is said, never claimed done.
 */
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Capacitor } from '@capacitor/core';
import { Check, CircleAlert, Printer, RefreshCw, Share2, ShieldCheck, X } from 'lucide-react';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { FieldOperator } from '../data/fieldOperatorClient';
import { identityErrorCode, reissueCard, sendWorkerCode, verifyWorkerCode } from '../data/workerIdentityClient';
import { cardQrPayload, displayCardCode } from './cardCode';
import { renderCardPicture } from './cardPicture';
import { widText, type WidWord } from './widCopy';

interface Props {
    farmId: string;
    worker: FieldOperator;
    onClose: () => void;
    /** The server's answer after a change (phone verified, new card), for the list. */
    onChanged?: (worker: FieldOperator) => void;
    /** Whether this is the installed app (no print there). Read from the platform when not given. */
    isNative?: boolean;
}

const CODE_ERRORS: Record<string, WidWord> = {
    'identity.sms_off': 'smsOff',
    'identity.sms_failed': 'failed',
    'identity.code_wrong': 'codeWrong',
    'identity.code_expired': 'codeExpired',
    'identity.no_phone': 'noPhone',
    'identity.too_many_codes': 'tooMany',
    'identity.number_verified_elsewhere': 'verifiedElsewhere',
};

/** One rung of the ladder (screen 2): done, or still pending. */
const LevelRow: React.FC<{ id: string; label: string; done: boolean; language?: string | null }> = ({ id, label, done, language }) => (
    <div data-testid={id} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[14.5px] font-extrabold ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-500'}`}>
        {done ? <Check size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
        {label}
        <span className="ml-auto text-[12.5px]">{widText(done ? 'done' : 'pending', language)}</span>
    </div>
);

const BTN = 'flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-2xl border text-[15px] font-extrabold transition-transform active:scale-[0.98] disabled:opacity-50';

export const WorkerCardSheet: React.FC<Props> = ({ farmId, worker, onClose, onChanged, isNative }) => {
    const language = useOptionalLanguage()?.language;
    const native = isNative ?? Capacitor.isNativePlatform();
    const [current, setCurrent] = useState<FieldOperator>(worker);
    const [qr, setQr] = useState<string | null>(null);
    const [note, setNote] = useState<{ kind: 'ok' | 'ask'; text: string } | null>(null);
    const [ticket, setTicket] = useState<string | null>(null);
    const [codeTail, setCodeTail] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirmNewCard, setConfirmNewCard] = useState(false);
    useBackDismiss(true, onClose);

    const card = current.cardCode ? displayCardCode(current.cardCode) : null;
    const verified = current.identityLevel === 'PhoneVerified';
    const payload = card ? cardQrPayload(card) : null;

    useEffect(() => {
        if (!payload) return;
        let cancelled = false;
        QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 360 })
            .then((url) => { if (!cancelled) setQr(url); })
            .catch(() => { if (!cancelled) setQr(null); });
        return () => { cancelled = true; };
    }, [payload]);

    const say = (error: unknown) => {
        const key = CODE_ERRORS[identityErrorCode(error) ?? ''] ?? 'failed';
        setNote({ kind: 'ask', text: widText(key, language) });
    };

    const changed = (patch: Partial<FieldOperator>) => {
        const next = { ...current, ...patch };
        setCurrent(next);
        onChanged?.(next);
    };

    const share = async () => {
        if (!card) return;
        const brand = widText('cardBrand', language);
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        try {
            const picture = await renderCardPicture({ brand, name: current.displayName, identifyLine: current.fullName, code: card });
            const file = picture ? new File([picture], `${card}.png`, { type: 'image/png' }) : null;
            if (file && nav?.share && nav.canShare?.({ files: [file] })) {
                await nav.share({ files: [file], title: brand, text: `${current.displayName} · ${card}` });
                return;
            }
            if (nav?.share) {
                await nav.share({ title: brand, text: `${current.displayName} · ${card}`, url: payload ?? undefined });
                return;
            }
            await nav?.clipboard?.writeText(payload ?? card);
            setNote({ kind: 'ok', text: widText('linkCopied', language) });
        } catch {
            setNote({ kind: 'ask', text: widText('shareFailed', language) });
        }
    };

    const startVerify = async () => {
        setBusy(true);
        setNote(null);
        try {
            const sent = await sendWorkerCode(farmId, current.id);
            setTicket(sent.ticket);
            setCodeTail(sent.phoneTail);
            setCode('');
        } catch (error) {
            say(error);
        } finally {
            setBusy(false);
        }
    };

    const finishVerify = async () => {
        if (!ticket || code.length !== 4) return;
        setBusy(true);
        try {
            const view = await verifyWorkerCode(farmId, current.id, ticket, code);
            setTicket(null);
            changed({ identityLevel: view.identityLevel, needsPhoneAndPin: view.needsPhoneAndPin });
            setNote({ kind: 'ok', text: widText('verifiedNote', language, { name: current.displayName }) });
        } catch (error) {
            say(error);
        } finally {
            setBusy(false);
        }
    };

    const newCard = async () => {
        setBusy(true);
        try {
            const issued = await reissueCard(farmId, current.id);
            setConfirmNewCard(false);
            changed({ cardCode: issued.cardCode });
            setNote({ kind: 'ok', text: widText('newCardDone', language) });
        } catch (error) {
            say(error);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
            <div data-testid="worker-card-sheet" className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[17px] font-extrabold text-stone-800">{current.displayName} · {widText('cardTitle', language)}</h3>
                    <button type="button" onClick={onClose} aria-label={widText('close', language)} className="rounded-full p-2 hover:bg-stone-100">
                        <X size={20} className="text-stone-500" />
                    </button>
                </div>

                <div id="wid-print-card" className="rounded-[20px] bg-gradient-to-br from-emerald-900 to-emerald-700 p-4 text-white">
                    <div className="text-[13px] font-extrabold tracking-wide opacity-85">{widText('cardBrand', language)}</div>
                    <div data-testid="card-name" className="mt-1.5 text-[22px] font-extrabold">{current.displayName}</div>
                    {current.fullName && <div className="text-[13.5px] font-semibold opacity-90">{current.fullName}</div>}
                    <div className="mx-auto mb-2 mt-3 w-44 rounded-2xl bg-white p-2.5">
                        {qr && payload && <img data-testid="card-qr" data-payload={payload} src={qr} alt={card ?? ''} className="h-auto w-full" />}
                    </div>
                    <div data-testid="card-code" className="text-center font-mono text-[20px] font-extrabold tracking-[0.12em]">{card ?? '—'}</div>
                </div>

                <div className="mt-3 flex flex-col gap-1.5">
                    <LevelRow id="card-level-name" label={widText('levelNameDone', language)} done language={language} />
                    <LevelRow id="card-level-card" label={widText('levelCardDone', language)} done={Boolean(card)} language={language} />
                    <LevelRow id="card-level-phone" label={widText('levelPhoneDone', language)} done={verified} language={language} />
                </div>

                <div className="mt-3 flex gap-2">
                    <button type="button" data-testid="card-share" disabled={!card || busy} onClick={() => void share()} className={`${BTN} border-emerald-600 bg-emerald-600 text-white`}>
                        <Share2 size={18} aria-hidden /> {widText('shareWhatsApp', language)}
                    </button>
                    {!native && (
                        <button type="button" data-testid="card-print" disabled={!card} onClick={() => window.print()} className={`${BTN} border-stone-200 bg-white text-stone-700`}>
                            <Printer size={18} aria-hidden /> {widText('print', language)}
                        </button>
                    )}
                </div>

                {!verified && !ticket && (
                    <button type="button" data-testid="card-verify" disabled={busy} onClick={() => void startVerify()} className={`${BTN} mt-2 w-full border-blue-700 bg-blue-700 text-white`}>
                        <ShieldCheck size={18} aria-hidden /> {widText('verifyPhone', language)}
                    </button>
                )}
                {ticket && (
                    <div className="mt-3 rounded-2xl border border-stone-200 p-3">
                        <p className="text-[14.5px] font-bold text-stone-700">{widText('codeSent', language, { name: current.displayName, tail: codeTail })}</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-stone-500">{widText('codeAsk', language, { name: current.displayName })}</p>
                        <input data-testid="card-code-input" inputMode="numeric" maxLength={4} value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            className="mt-2 min-h-[56px] w-full rounded-xl border-2 border-stone-300 text-center font-mono text-[28px] font-extrabold tracking-[0.5em] focus:border-emerald-500 focus:outline-none" />
                        <div className="mt-2 flex gap-2">
                            <button type="button" data-testid="card-code-submit" disabled={busy || code.length !== 4} onClick={() => void finishVerify()} className={`${BTN} border-emerald-600 bg-emerald-600 text-white`}>
                                {widText('verify', language)}
                            </button>
                            <button type="button" onClick={() => setTicket(null)} className={`${BTN} border-stone-200 bg-white text-stone-600`}>
                                {widText('later', language)}
                            </button>
                        </div>
                    </div>
                )}

                {!confirmNewCard ? (
                    <button type="button" data-testid="card-reissue" disabled={busy || !card} onClick={() => setConfirmNewCard(true)}
                        className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-1.5 text-[13.5px] font-bold text-stone-500">
                        <RefreshCw size={15} aria-hidden /> {widText('newCard', language)}
                    </button>
                ) : (
                    <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[14px] font-bold text-amber-900">
                        <p>{widText('newCardAsk', language)}</p>
                        <div className="mt-2 flex gap-2">
                            <button type="button" data-testid="card-reissue-confirm" disabled={busy} onClick={() => void newCard()} className={`${BTN} border-emerald-600 bg-emerald-600 text-white`}>
                                {widText('newCard', language)}
                            </button>
                            <button type="button" onClick={() => setConfirmNewCard(false)} className={`${BTN} border-stone-200 bg-white text-stone-600`}>
                                {widText('later', language)}
                            </button>
                        </div>
                    </div>
                )}

                {note && (
                    <p role="status" data-testid="card-note" className={`mt-3 rounded-xl px-3 py-2 text-[13.5px] font-semibold ${note.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                        {note.text}
                    </p>
                )}
            </div>
        </div>
    );
};
