/**
 * FarmInviteQrSheet — the owner-side "Share farm QR" modal.
 *
 * Design intent (semi-literate friendly):
 *   - One screen, no settings, no policy controls.
 *   - QR is big. Farm name is big. Everything else is secondary.
 *   - "Share" button uses navigator.share so WhatsApp is one tap.
 *   - One language at a time (pilot lane IDENT): Marathi mode Marathi only, English mode English only (`inviteQrWords`).
 *
 * Backend: calls POST /shramsafal/farms/{farmId}/invite-qr. The server
 * is the authoritative source for the token + farmCode; opening the
 * sheet twice returns the same QR (idempotent) until the owner taps
 * "Generate new QR" which calls the rotate endpoint.
 */

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { X, Share2, Copy, Check, RefreshCcw, Users } from 'lucide-react';
import {
    issueFarmInvite,
    rotateFarmInvite as apiRotateInvite,
    isInviteApiError,
    type InviteResponse,
} from './inviteApi';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { inviteShareUrl } from './inviteShareUrl';
import { inviteQrWords } from './inviteQrWords';

/*
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — "type this code" is TRUE now (the joiner's
 * app has a door that takes it), so the line says where to type it, in the words on that door.
 *
 * F5 (doctrine P11): that door exists only in the NEW app. An installed 1.0.16 has no such button
 * (its only code box asks for a link), so the line says so and what to do — update the app —
 * instead of naming a button the worker cannot find. Scanning the QR works on every version.
 * Both lines live in `inviteQrWords` (typeCodeLine, oldAppLine).
 */
type SheetProblem = { kind: 'unreachable' } | { kind: 'refused'; message: string } | { kind: 'rotateFailed' };

interface FarmInviteQrSheetProps {
    isOpen: boolean;
    onClose: () => void;
    farmId: string;
    farmName: string;
}

const FarmInviteQrSheet: React.FC<FarmInviteQrSheetProps> = ({ isOpen, onClose, farmId, farmName }) => {
    const w = inviteQrWords(useOptionalLanguage()?.language);
    const [invite, setInvite] = useState<InviteResponse | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [qrError, setQrError] = useState<boolean>(false);
    const [problem, setProblem] = useState<SheetProblem | null>(null);
    const [copied, setCopied] = useState<'link' | 'code' | null>(null);
    const [confirmingRotate, setConfirmingRotate] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setIsLoading(true);
        setProblem(null);
        setCopied(null);
        setConfirmingRotate(false);
        setInvite(null);
        issueFarmInvite(farmId)
            .then(result => {
                if (cancelled) return;
                setInvite(result);
            })
            .catch(err => {
                if (cancelled) return;
                setProblem(isInviteApiError(err) ? { kind: 'refused', message: err.message } : { kind: 'unreachable' });
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, farmId]);

    // The same address the hub's farm card draws (`inviteShareUrl`): an internal deep link that lands on the join page.
    const shareUrl = useMemo(() => (invite ? inviteShareUrl(invite) : ''), [invite]);

    useEffect(() => {
        if (!shareUrl) return;
        let cancelled = false;
        QRCode.toDataURL(shareUrl, {
            errorCorrectionLevel: 'H',
            margin: 1,
            width: 420,
            color: { dark: '#0f172a', light: '#ffffff' },
        })
            .then(url => {
                if (cancelled) return;
                setQrDataUrl(url);
                setQrError(false);
            })
            .catch(() => {
                if (cancelled) return;
                setQrError(true);
            });
        return () => {
            cancelled = true;
        };
    }, [shareUrl]);

    const handleCopy = async (value: string, kind: 'link' | 'code') => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(kind);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard denied — user can long-press the text */
        }
    };

    const handleShare = async () => {
        if (!invite) return;
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({
                    title: w.shareTitle(invite.farmName),
                    text: w.shareText(invite.farmName),
                    url: shareUrl,
                });
                return;
            } catch {
                // User cancelled or share not allowed — fall back to copy
            }
        }
        await handleCopy(shareUrl, 'link');
    };

    const handleRotate = async () => {
        if (!confirmingRotate) {
            setConfirmingRotate(true);
            return;
        }
        setIsLoading(true);
        setProblem(null);
        try {
            const fresh = await apiRotateInvite(farmId);
            setInvite(fresh);
        } catch (err) {
            setProblem(isInviteApiError(err) ? { kind: 'refused', message: err.message } : { kind: 'rotateFailed' });
        } finally {
            setIsLoading(false);
            setConfirmingRotate(false);
        }
    };

    useBackDismiss(isOpen, onClose);
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60 px-3 py-4 backdrop-blur-sm sm:items-center"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={w.close}
                    data-testid="invite-close"
                    className="absolute right-3 top-3 rounded-full bg-stone-100 p-2 text-stone-600 hover:bg-stone-200"
                >
                    <X size={18} />
                </button>

                <div className="px-6 pb-5 pt-8">
                    <div className="mb-4 text-center">
                        <div className="mx-auto mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                            <Users size={12} /> {w.badge}
                        </div>
                        <h2 className="font-display text-2xl font-black text-stone-900">
                            {invite?.farmName ?? farmName}
                        </h2>
                        <p className="mt-1 text-sm font-semibold text-stone-500">
                            {w.caption}
                        </p>
                    </div>

                    <div className="flex justify-center">
                        {problem ? (
                            <div data-testid="invite-problem" className="flex h-[280px] w-full max-w-[320px] items-center justify-center rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700">
                                {problem.kind === 'refused' ? w.refused(problem.message) : problem.kind === 'rotateFailed' ? w.rotateFailed : w.unreachable}
                            </div>
                        ) : qrError ? (
                            <div className="flex h-[280px] w-full max-w-[320px] items-center justify-center rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700">
                                {w.qrFailed}
                            </div>
                        ) : (isLoading || !qrDataUrl) ? (
                            <div className="flex h-[280px] w-full max-w-[320px] items-center justify-center rounded-3xl border border-stone-200 bg-stone-50">
                                <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-emerald-500" />
                            </div>
                        ) : (
                            <div className="rounded-3xl border border-stone-200 bg-white p-3 shadow-md">
                                <img
                                    src={qrDataUrl}
                                    alt={w.qrAlt(invite?.farmName ?? farmName)}
                                    data-testid="invite-qr-image"
                                    className="h-[260px] w-[260px] max-w-full"
                                />
                            </div>
                        )}
                    </div>

                    {/* Never a blank code: an older server answered `farmCode: ""` for a farm
                        that had none (D-1). No code, no box and no "type this code" line. */}
                    {invite && (invite.farmCode ?? '').trim() !== '' && (
                        <div data-testid="invite-farm-code-card" className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-center">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                                {w.codeLabel}
                            </div>
                            <button
                                type="button"
                                onClick={() => handleCopy(invite.farmCode, 'code')}
                                className="group mt-1 inline-flex items-center gap-2 font-mono text-3xl font-black tracking-[0.35em] text-stone-900"
                                aria-label={w.copyCode}
                            >
                                {invite.farmCode}
                                {copied === 'code' ? (
                                    <Check size={16} className="text-emerald-600" />
                                ) : (
                                    <Copy size={14} className="text-stone-400 opacity-0 transition-opacity group-hover:opacity-100" />
                                )}
                            </button>
                            <div data-testid="invite-type-code-line" className="mt-1 text-[12px] font-semibold leading-snug text-stone-600">
                                {w.typeCodeLine}
                            </div>
                            <div data-testid="invite-old-app-line" className="mt-1 text-[11px] leading-snug text-stone-500">
                                {w.oldAppLine}
                            </div>
                        </div>
                    )}

                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={handleShare}
                            data-testid="invite-share"
                            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
                        >
                            <Share2 size={16} />
                            {w.share}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCopy(shareUrl, 'link')}
                            data-testid="invite-copy-link"
                            className="flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700 hover:bg-stone-50"
                        >
                            {copied === 'link' ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                            {copied === 'link' ? w.copied : w.copyLink}
                        </button>
                    </div>

                    <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-stone-400">
                        <button
                            type="button"
                            onClick={handleRotate}
                            data-testid="invite-rotate"
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-bold transition-colors ${
                                confirmingRotate
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300'
                            }`}
                        >
                            <RefreshCcw size={11} />
                            {confirmingRotate ? w.rotateConfirm : w.rotate}
                        </button>
                    </div>

                    <p className="mt-4 text-center text-[11px] leading-relaxed text-stone-400" data-testid="invite-footer">
                        {w.footer}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default FarmInviteQrSheet;
