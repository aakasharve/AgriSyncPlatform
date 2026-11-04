/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (orchestrator call 4; reused by MU-2). Reads a ShramSafal
 * card: NO new library — the platform's own QR detection (`BarcodeDetector`, through the camera permission the app
 * already declares) when the phone has it, and ALWAYS a typed-code fallback. Where `BarcodeDetector` is missing, only
 * the typed code is shown (no camera that could not read anything).
 *
 * It only READS a code and hands its 8-character body back (`onCode`); what the code is, the server says
 * (scan-resolve, R6). A text that is not a card code is a calm question, never sent.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, ScanLine } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { normalizeCardCode } from './cardCode';
import { widText } from './widCopy';

interface DetectedCode { rawValue?: string }
interface QrDetector { detect: (source: CanvasImageSource) => Promise<DetectedCode[]> }
type QrDetectorCtor = new (options?: { formats?: string[] }) => QrDetector;

/** The platform's QR detector, or null where the phone has none. */
export function platformQrDetector(): QrDetectorCtor | null {
    const ctor = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    return typeof ctor === 'function' ? (ctor as QrDetectorCtor) : null;
}

interface Props {
    onCode: (codeBody: string) => void;
    onCancel: () => void;
    /** Hold reading while the caller is busy with a code already read. */
    paused?: boolean;
}

export const CardScanner: React.FC<Props> = ({ onCode, onCancel, paused }) => {
    const language = useOptionalLanguage()?.language;
    const Detector = platformQrDetector();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [cameraFailed, setCameraFailed] = useState(false);
    const [typed, setTyped] = useState('');
    const [typedWrong, setTypedWrong] = useState(false);
    const onCodeRef = useRef(onCode);
    onCodeRef.current = onCode;
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    useEffect(() => {
        if (!Detector) return;
        const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
        if (!media || typeof media.getUserMedia !== 'function') {
            setCameraFailed(true);
            return;
        }
        let stream: MediaStream | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;
        let stopped = false;
        const detector = new Detector({ formats: ['qr_code'] });

        void media.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
            .then(async (s) => {
                if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
                stream = s;
                const video = videoRef.current;
                if (!video) return;
                video.srcObject = s;
                await video.play().catch(() => undefined);
                timer = setInterval(() => {
                    if (pausedRef.current || !videoRef.current) return;
                    void detector.detect(videoRef.current).then((found) => {
                        const body = found.map((f) => normalizeCardCode(f.rawValue)).find((b): b is string => b !== null);
                        if (body) onCodeRef.current(body);
                    }).catch(() => undefined);
                }, 400);
            })
            .catch(() => setCameraFailed(true));

        return () => {
            stopped = true;
            if (timer) clearInterval(timer);
            stream?.getTracks().forEach((t) => t.stop());
        };
    }, [Detector]);

    const submitTyped = () => {
        const body = normalizeCardCode(typed);
        if (!body) {
            setTypedWrong(true);
            return;
        }
        setTypedWrong(false);
        onCode(body);
    };

    return (
        <div data-testid="card-scanner" className="space-y-3">
            {Detector && !cameraFailed && (
                <div className="relative grid h-56 place-items-center overflow-hidden rounded-2xl bg-stone-800">
                    <video ref={videoRef} data-testid="scanner-video" muted playsInline className="absolute inset-0 h-full w-full object-cover" />
                    <div className="pointer-events-none absolute inset-x-14 inset-y-8 rounded-xl border-[3px] border-emerald-400" />
                    <span className="relative flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-[14px] font-bold text-white">
                        <ScanLine size={16} aria-hidden /> {widText('holdQr', language)}
                    </span>
                </div>
            )}
            {Detector && cameraFailed && (
                <p data-testid="scanner-camera-off" className="rounded-xl bg-stone-50 p-3 text-[14px] font-semibold text-stone-600">{widText('cameraOff', language)}</p>
            )}

            <div>
                <label htmlFor="scanner-typed" className="mb-1.5 ml-1 flex items-center gap-1.5 text-[13px] font-extrabold text-stone-500">
                    <Keyboard size={14} aria-hidden /> {widText('typeCode', language)}
                </label>
                <div className="flex gap-2">
                    <input id="scanner-typed" data-testid="scanner-typed-input" value={typed} maxLength={40} autoCapitalize="characters"
                        placeholder="SS-7K4M-29QX"
                        onChange={(e) => { setTyped(e.target.value); setTypedWrong(false); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') submitTyped(); }}
                        className="min-h-[52px] flex-1 rounded-xl border border-stone-200 bg-white px-3 font-mono text-[18px] font-bold tracking-wider text-stone-800 focus:border-emerald-500 focus:outline-none" />
                    <button type="button" data-testid="scanner-typed-submit" onClick={submitTyped} disabled={!typed.trim() || paused}
                        className="min-h-[52px] rounded-xl bg-emerald-600 px-4 text-[16px] font-extrabold text-white disabled:opacity-50">
                        {widText('find', language)}
                    </button>
                </div>
                {typedWrong && (
                    <p data-testid="scanner-typed-error" className="ml-1 mt-1 text-[13px] font-semibold text-amber-700">{widText('typedNotCode', language)}</p>
                )}
            </div>

            <button type="button" onClick={onCancel} className="min-h-[48px] w-full rounded-xl border border-stone-200 bg-white text-[15px] font-bold text-stone-600">
                {widText('later', language)}
            </button>
        </div>
    );
};
