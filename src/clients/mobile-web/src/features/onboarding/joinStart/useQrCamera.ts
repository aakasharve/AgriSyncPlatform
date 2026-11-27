/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — the phone's camera for the full-screen
 * scanner before sign-in. NO new library: the platform's own QR detection (`BarcodeDetector`, through the camera
 * permission the app already declares), exactly as the worker-card scanner reads it (`CardScanner`, lane WID). Where the
 * phone has no detector, or the camera does not start, the screen says so and the typed code is the way on.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { platformQrDetector } from '../../labour/identity/CardScanner';

/** `none`: this phone has no QR reader. `off`: the camera did not start. */
export type QrCameraState = 'starting' | 'on' | 'off' | 'none';

/** Reads QR codes from the video. `onRaw` answers true when it took the code (reading then stops). */
export function useQrCamera(videoRef: RefObject<HTMLVideoElement | null>, onRaw: (raw: string) => boolean): QrCameraState {
    const Detector = platformQrDetector();
    const [state, setState] = useState<QrCameraState>(Detector ? 'starting' : 'none');
    const onRawRef = useRef(onRaw);
    onRawRef.current = onRaw;

    useEffect(() => {
        if (!Detector) return undefined;
        const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
        if (!media || typeof media.getUserMedia !== 'function') {
            setState('off');
            return undefined;
        }
        let stream: MediaStream | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;
        let stopped = false;
        let taken = false;
        const detector = new Detector({ formats: ['qr_code'] });

        void media.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
            .then(async (s) => {
                if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
                stream = s;
                const video = videoRef.current;
                if (!video) return;
                video.srcObject = s;
                await video.play().catch(() => undefined);
                if (!stopped) setState('on');
                timer = setInterval(() => {
                    if (taken || !videoRef.current) return;
                    void detector.detect(videoRef.current).then((found) => {
                        for (const code of found) {
                            if (!taken && code.rawValue && onRawRef.current(code.rawValue)) taken = true;
                        }
                    }).catch(() => undefined);
                }, 400);
            })
            .catch(() => { if (!stopped) setState('off'); });

        return () => {
            stopped = true;
            if (timer) clearInterval(timer);
            stream?.getTracks().forEach((t) => t.stop());
        };
    }, [Detector, videoRef]);

    return state;
}
