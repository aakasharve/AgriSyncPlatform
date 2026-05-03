/**
 * FarmInviteQrSheet — the owner-side "Share farm QR" modal.
 *
 * Design intent (semi-literate friendly):
 *   - One screen, no settings, no policy controls.
 *   - QR is big. Farm name is big. Everything else is secondary.
 *   - "Share" button uses navigator.share so WhatsApp is one tap.
 *   - Marathi first, English in the same visual weight.
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

interface FarmInviteQrSheetProps {
    isOpen: boolean;
    onClose: () => void;
    farmId: string;
    farmName: string;
}

const FarmInviteQrSheet: React.FC<FarmInviteQrSheetProps> = ({ isOpen, onClose, farmId, farmName }) => {
    const [invite, setInvite] = useState<InviteResponse | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [qrError, setQrError] = useState<string | null>(null);
    const [apiError, setApiError] = useState<string | null>(null);
    const [copied, setCopied] = useState<'link' | 'code' | null>(null);
    const [confirmingRotate, setConfirmingRotate] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setIsLoading(true);
        setApiError(null);
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
                const message = isInviteApiError(err)
                    ? err.message
                    : 'Could not reach the server. Pull down to retry.';
                setApiError(message);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, farmId]);

    const shareUrl = useMemo(() => {
        if (!invite) return '';
        // When running on the mobile-web origin (localhost in dev, app.shramsafal.in
        // in prod), build an internal deep-link so scanning lands on the
        // JoinFarmLandingPage without a round-trip through the marketing site.
        // The server also returned `invite.qrPayload` with the public marketing
        // URL that will 302 here in prod.
        if (typeof window === 'undefined') return invite.qrPayload;
        const params = new URLSearchParams();
        params.set('join', invite.token);
        params.set('farm', invite.farmCode);
        return new URL(`/?${params.toString()}`, window.location.origin).toString();
    }, [invite]);

    useEffect(() => {
        if (!invite || !shareUrl) return;
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
                setQrError(null);
            })
            .catch(err => {
                if (cancelled) return;
                setQrError(err instanceof Error ? err.message : 'QR generation failed.');
            });
        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
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
                    title: `Join ${invite.farmName} on ShramSafal`,
                    text: `${invite.farmName} मध्ये सामील व्हा · Join ${invite.farmName}`,
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
        setApiError(null);
        try {
            const fresh = await apiRotateInvite(farmId);
            setInvite(fresh);
        } catch (err) {
            setApiError(isInviteApiError(err) ? err.message : 'Rotation failed.');
        } finally {
            setIsLoading(false);
            setConfirmingRotate(false);
        }
    };

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
                    aria-label="Close"
                    className="absolute right-3 top-3 rounded-full bg-stone-100 p-2 text-stone-600 hover:bg-stone-200"
                >
                    <X size={18} />
                </button>

                <div className="px-6 pb-5 pt-8">
                    <div className="mb-4 text-center">
                        <div className="mx-auto mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                            <Users size={12} /> Invite to farm
                        </div>
                        <h2 className="font-display text-2xl font-black text-stone-900">
                            {invite?.farmName ?? farmName}
                        </h2>
                        <p className="mt-1 text-sm font-semibold text-stone-500">
                            तुमच्या कामगारांना ही QR दाखवा
                        </p>
                        <p className="text-xs text-stone-400">
                            Show this QR to your workers.
                        </p>
                    </div>

                    <div className="flex justify-center">
                        {apiError ? (
                            <div className="flex h-[320px] w-[320px] items-center justify-center rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700">
                                {apiError}
                            </div>
                        ) : qrError ? (
                            <div className="flex h-[320px] w-[320px] items-center justify-center rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700">
                                {qrError}
                            </div>
                        ) : (isLoading || !qrDataUrl) ? (
                            <div className="flex h-[320px] w-[320px] items-center justify-center rounded-3xl border border-stone-200 bg-stone-50">
                                <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-emerald-500" />
                            </div>
                        ) : (
                            <div className="rounded-3xl border border-stone-200 bg-white p-3 shadow-md">
                                <img
                                    src={qrDataUrl}
                                    alt={`QR code to join ${invite?.farmName ?? farmName}`}
                                    className="h-[300px] w-[300px]"
                                />
                            </div>
                        )}
                    </div>

                    {invite && (
                        <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-center">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                                Farm code · शेती कोड
                            </div>
                            <button
                                type="button"
                                onClick={() => handleCopy(invite.farmCode, 'code')}
                                className="group mt-1 inline-flex items-center gap-2 font-mono text-3xl font-black tracking-[0.35em] text-stone-900"
                                aria-label="Copy farm code"
                            >
                                {invite.farmCode}
                                {copied === 'code' ? (
                                    <Check size={16} className="text-emerald-600" />
                                ) : (
                                    <Copy size={14} className="text-stone-400 opacity-0 transition-opacity group-hover:opacity-100" />
                                )}
                            </button>
                            <div className="mt-1 text-[11px] text-stone-500">
                                Workers who cannot scan can type this code to join.
                            </div>
                        </div>
                    )}

                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={handleShare}
                            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
                        >
                            <Share2 size={16} />
                            Share
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCopy(shareUrl, 'link')}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700 hover:bg-stone-50"
                        >
                            {copied === 'link' ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                            {copied === 'link' ? 'Copied' : 'Copy link'}
                        </button>
                    </div>

                    <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-stone-400">
                        <button
                            type="button"
                            onClick={handleRotate}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-bold transition-colors ${
                                confirmingRotate
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300'
                            }`}
                        >
                            <RefreshCcw size={11} />
                            {confirmingRotate ? 'Tap again to replace QR' : 'Generate new QR'}
                        </button>
                    </div>

                    <p className="mt-4 text-center text-[11px] leading-relaxed text-stone-400">
                        तुमच्या कामगाराने ही QR स्कॅन केल्यावर त्यांना त्यांचा फोन नंबर आणि OTP द्यावा लागेल.
                        <br />
                        Once a worker scans, they enter their phone and OTP. That's it.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default FarmInviteQrSheet;
