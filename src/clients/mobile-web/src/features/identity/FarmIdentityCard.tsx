/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; drawing V2-A card 1; CTO ruling Q6 = A) - "शेताची ओळख" at the top of the
 * सेट-अप केंद्र: the farm OPEN in the app (it follows a farm switch), its name as the owner typed it, "शेताचा ओळख क्रमांक" (tap to copy: "कोड कॉपी
 * केला"), and - for the MAIN owner only, the one the server lets make it - the join QR drawn on the card with "कामाला येणाऱ्यांना ही QR दाखवा".
 *
 * The QR is the existing idempotent call (`POST /shramsafal/farms/{id}/invite-qr`); its answer is kept on the owner's phone per farm, so the QR
 * draws offline after the first time. With no network and nothing kept, the card says "इंटरनेट आल्यावर QR दिसेल" (P5: never a blank square).
 * Tapping the QR opens the existing sheet (share, copy, new QR); tapping the farm's name opens that farm's own "शेताची ओळख" page.
 */
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ChevronRight, Copy, Sprout } from 'lucide-react';
import { GlassCard } from '../../shared/components/ui/placeUi';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { issueFarmInvite, type InviteResponse } from '../onboarding/qr/inviteApi';
import { inviteShareUrl } from '../onboarding/qr/inviteShareUrl';
import { identityWords } from './identityWords';

export const farmJoinQrKey = (farmId: string) => `farm:joinQr:${farmId}`;

type QrState = 'off' | 'loading' | 'ready' | 'offline' | 'failed';

/** The farm's join QR as a picture, for the main owner only (`enabled`). `refreshKey` asks again (after the sheet made a new one). */
export function useFarmJoinQr(farmId: string | null, enabled: boolean, refreshKey: number): { dataUrl: string | null; state: QrState } {
    const [kept, setKept, keptLoaded] = useUiPref<InviteResponse | null>(farmJoinQrKey(farmId ?? '__no_farm__'), null);
    const [asked, setAsked] = useState<'loading' | 'ok' | 'offline' | 'failed'>('loading');
    const [dataUrl, setDataUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || !farmId) return undefined;
        let alive = true;
        setAsked('loading');
        // Never throws into the screen: any failure (even one before the request starts) is a QR not got.
        Promise.resolve().then(() => issueFarmInvite(farmId)).then(
            invite => { if (alive) { setKept(invite); setAsked('ok'); } },
            err => { if (alive) setAsked(typeof err === 'object' && err && 'status' in err ? 'failed' : 'offline'); },
        );
        return () => { alive = false; };
        // setKept writes this farm's key; asking again is driven by the farm and the refresh key only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [farmId, enabled, refreshKey]);

    const invite = enabled && kept && kept.farmId === farmId ? kept : null;
    const url = invite ? inviteShareUrl(invite) : '';
    useEffect(() => {
        if (!url) { setDataUrl(null); return undefined; }
        let alive = true;
        QRCode.toDataURL(url, { errorCorrectionLevel: 'H', margin: 1, width: 352, color: { dark: '#0f172a', light: '#ffffff' } })
            .then(d => { if (alive) setDataUrl(d); }, () => { if (alive) setDataUrl(null); });
        return () => { alive = false; };
    }, [url]);

    if (!enabled || !farmId) return { dataUrl: null, state: 'off' };
    if (dataUrl) return { dataUrl, state: 'ready' };
    if (!keptLoaded || asked === 'loading') return { dataUrl: null, state: 'loading' };
    return { dataUrl: null, state: asked === 'failed' ? 'failed' : asked === 'offline' ? 'offline' : 'loading' };
}

export interface FarmIdentityCardProps {
    farmId: string | null;
    farmName: string | null;
    farmCode: string | null;
    /** The server lets only the PRIMARY owner make the join QR (Q6 = A). */
    isPrimaryOwner: boolean;
    language: 'mr' | 'en';
    onOpenFarmPage: () => void;
    onOpenQrSheet: () => void;
    /** Bumped when the QR sheet closes (it may have made a new QR). */
    qrRefreshKey?: number;
}

export const FarmIdentityCard: React.FC<FarmIdentityCardProps> = ({
    farmId, farmName, farmCode, isPrimaryOwner, language, onOpenFarmPage, onOpenQrSheet, qrRefreshKey = 0,
}) => {
    const words = identityWords(language);
    const qr = useFarmJoinQr(farmId, isPrimaryOwner, qrRefreshKey);
    const [toast, setToast] = useState(false);
    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(() => setToast(false), 1600);
        return () => clearTimeout(t);
    }, [toast]);

    const copy = async () => {
        if (!farmCode) return;
        try { await navigator.clipboard?.writeText(farmCode); } catch { /* the code is still on the screen to read out */ }
        setToast(true);
    };

    return (
        <GlassCard testId="hub-farm-card">
            <button type="button" onClick={onOpenFarmPage} aria-label={words.openFarmPage} data-testid="hub-farm-card-open"
                className="flex w-full items-center gap-2 text-left">
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-stone-500"><Sprout size={16} aria-hidden="true" />{words.farmCap}</span>
                    <span className="mt-1 block text-[26px] font-black leading-tight text-stone-900 [overflow-wrap:anywhere]" data-testid="hub-farm-name">{farmName || '—'}</span>
                </span>
                <ChevronRight size={22} className="shrink-0 text-stone-400" aria-hidden="true" />
            </button>
            {farmCode && (
                <button type="button" onClick={() => { void copy(); }} aria-label={words.copyCode} data-testid="hub-farm-code"
                    className="mt-2.5 block w-full rounded-2xl bg-stone-100 px-3 py-2 text-left">
                    <span className="block text-[12px] font-bold text-stone-500">{words.farmCode}</span>
                    <span className="flex items-center gap-2.5 font-mono text-[26px] font-extrabold tracking-[0.24em] text-stone-900">
                        {farmCode}<Copy size={18} className="shrink-0 text-stone-500" aria-hidden="true" />
                    </span>
                </button>
            )}
            {toast && <p role="status" className="m-0 mt-1.5 text-center text-[13.5px] font-extrabold text-emerald-800" data-testid="hub-farm-code-copied">{words.codeCopied}</p>}
            {isPrimaryOwner && farmId && (
                <div className="mt-3" data-testid="hub-farm-qr">
                    {qr.state === 'ready' && qr.dataUrl ? (
                        <button type="button" onClick={onOpenQrSheet} data-testid="hub-farm-qr-open"
                            className="mx-auto block rounded-[20px] border border-stone-200 bg-white p-2 shadow-sm">
                            <img src={qr.dataUrl} alt={words.qrAlt} className="h-[176px] w-[176px]" />
                        </button>
                    ) : (
                        <div className="mx-auto grid h-[176px] w-[176px] place-items-center rounded-[20px] border border-dashed border-stone-300 bg-stone-50 p-3 text-center text-[13px] font-bold text-stone-600" data-testid={`hub-farm-qr-${qr.state}`}>
                            {qr.state === 'offline' ? words.qrOffline : qr.state === 'failed' ? words.qrFailed : words.qrLoading}
                        </div>
                    )}
                    <p className="m-0 mt-1.5 text-center text-[13.5px] font-bold text-stone-600">{words.qrCaption}</p>
                </div>
            )}
        </GlassCard>
    );
};
