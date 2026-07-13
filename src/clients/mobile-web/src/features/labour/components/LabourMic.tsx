/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourMic — the SAME mic as the main log screen (features/voice/AudioRecorder):
 * a big centred gradient orb with the identical animation (emerald→rose, top
 * gloss, inner-shadow depth, animate-ping halo, Mic↔Square swap) and the same
 * "stop banner" below it — the "रद्द करा" discard pill, the "ऐकत आहे" heading
 * with a running mono timer, the auto-stop countdown, and the "थांबवण्यासाठी दाबा"
 * hint. Marathi copy is lifted verbatim from translations.ts (mr).
 *
 * Self-contained on purpose: the labour preview mounts before the app's provider
 * tree, so this uses the browser Web Speech API (mr-IN) for a live transcript —
 * the farmer sees what was heard — with a MediaRecorder fallback. No app
 * providers/backend needed. The real server voice engine swaps straight onto
 * this component's onTranscript at the backend phase.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';

interface Props {
    onTranscript?: (text: string) => void;
    onError?: (message: string) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const getSR = (): any => (typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null);
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const LabourMic: React.FC<Props> = ({ onTranscript, onError }) => {
    const [recording, setRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [err, setErr] = useState<string | null>(null);
    const [secs, setSecs] = useState(0);
    const supported = useRef<boolean>(!!getSR());
    const recRef = useRef<any>(null);
    const finalRef = useRef<string>('');
    const discardRef = useRef(false);
    const timerRef = useRef<number | undefined>(undefined);
    const mediaRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const startTimer = () => { setSecs(0); timerRef.current = window.setInterval(() => setSecs((s) => (s >= 60 ? s : s + 1)), 1000); };
    const stopTimer = () => window.clearInterval(timerRef.current);

    const startSR = () => {
        const SR = getSR();
        const rec = new SR();
        rec.lang = 'mr-IN';
        rec.continuous = true;
        rec.interimResults = true;
        finalRef.current = '';
        rec.onresult = (e: any) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i += 1) {
                const r = e.results[i];
                if (r.isFinal) finalRef.current += `${r[0].transcript} `;
                else interim += r[0].transcript;
            }
            setTranscript((finalRef.current + interim).trim());
        };
        rec.onerror = (e: any) => {
            const m = e.error === 'not-allowed' ? 'माइकला परवानगी द्या' : e.error === 'no-speech' ? 'काही ऐकू आलं नाही — पुन्हा बोला' : 'ऐकता आलं नाही';
            setErr(m);
            setRecording(false);
            stopTimer();
            onError?.(m);
        };
        rec.onend = () => {
            stopTimer();
            setRecording(false);
            if (discardRef.current) { discardRef.current = false; setTranscript(''); return; }
            const t = finalRef.current.trim();
            if (t) onTranscript?.(t);
        };
        recRef.current = rec;
        try { rec.start(); } catch { /* already started */ }
    };

    const startMR = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mr = new MediaRecorder(stream);
            mr.onstop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
            mediaRef.current = mr;
            mr.start();
        } catch (e) {
            const name = (e as { name?: string })?.name;
            const m = name === 'NotAllowedError' ? 'माइकला परवानगी द्या' : 'माइक उघडता आला नाही';
            setErr(m);
            setRecording(false);
            stopTimer();
            onError?.(m);
        }
    };

    // Single tap: flip to "listening" instantly (no double-tap), then start capture.
    const start = () => {
        setErr(null);
        setTranscript('');
        discardRef.current = false;
        setRecording(true);
        startTimer();
        if (supported.current) startSR(); else void startMR();
    };
    const stop = () => {
        stopTimer();
        setRecording(false);
        if (supported.current) { try { recRef.current?.stop(); } catch { /* noop */ } }
        else { try { mediaRef.current?.stop(); } catch { /* noop */ } }
    };
    // रद्द करा — abandon this recording; do NOT emit a transcript.
    const cancel = () => {
        discardRef.current = true;
        stopTimer();
        setRecording(false);
        setTranscript('');
        if (supported.current) { try { recRef.current?.stop(); } catch { /* noop */ } }
        else { try { mediaRef.current?.stop(); } catch { /* noop */ } }
    };

    // Auto-stop at 60s (mirrors AudioRecorder).
    useEffect(() => {
        if (recording && secs >= 60) stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [secs, recording]);
    useEffect(() => () => { stopTimer(); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

    return (
        <div className="flex flex-col items-center rounded-[28px] border border-white/60 bg-white/80 px-5 py-6 shadow-2xl shadow-emerald-100/60 backdrop-blur-xl">
            {/* MIC ORB — identical to the log screen */}
            <div className="relative mb-5">
                <button
                    type="button"
                    onClick={recording ? stop : start}
                    aria-label={recording ? 'थांबा' : 'बोला'}
                    className={`group relative flex h-32 w-32 items-center justify-center rounded-full outline-none transition-all duration-500 ${recording
                        ? 'scale-110 bg-gradient-to-br from-rose-500 to-red-600 shadow-2xl shadow-red-500/50 ring-4 ring-rose-200'
                        : 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-xl shadow-emerald-500/30 ring-4 ring-transparent hover:scale-105 hover:ring-emerald-200'}`}
                >
                    {/* top gloss shine */}
                    <div className="pointer-events-none absolute inset-x-4 top-2 h-1/2 rounded-full bg-gradient-to-b from-white/40 to-transparent opacity-80" />
                    {/* inner depth */}
                    <div className="pointer-events-none absolute inset-0 rounded-full opacity-30 shadow-inner mix-blend-multiply" />
                    {/* ping halo while recording */}
                    {recording && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-20" />}
                    {recording
                        ? <Square size={36} fill="currentColor" className="animate-pulse text-white drop-shadow-md" />
                        : <Mic size={48} className="text-white drop-shadow-md transition-transform group-hover:scale-110" />}
                </button>
            </div>

            {/* STOP BANNER — discard pill (only while recording) */}
            {recording && (
                <button
                    type="button"
                    onClick={cancel}
                    className="mb-4 flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-6 py-2.5 text-sm font-bold text-rose-600 transition-all duration-150 active:scale-95"
                >
                    <X size={14} strokeWidth={2.5} /> रद्द करा
                </button>
            )}

            {/* STATUS — listening + running timer / idle prompt */}
            <div className="mb-1 w-full text-center">
                {recording ? (
                    <>
                        <h3 className="mb-1 text-2xl font-bold text-stone-800">ऐकत आहे...</h3>
                        <p className="font-mono text-5xl font-medium tracking-wider text-emerald-700 [font-variant-numeric:tabular-nums]">{fmt(secs)}</p>
                    </>
                ) : (
                    <>
                        <h3 className="text-2xl font-bold text-stone-800">नोंद सुरू करा</h3>
                        <p className="mt-1 text-[15px] text-stone-400">बोलण्यासाठी माइक दाबा</p>
                    </>
                )}
            </div>

            {recording && secs >= 50 && (
                <div className="mb-2 animate-pulse text-center font-bold text-amber-600">{60 - secs} सेकंदात आपोआप थांबेल...</div>
            )}
            {recording && <p className="animate-pulse text-sm text-stone-400">थांबवण्यासाठी दाबा</p>}

            {/* LIVE TRANSCRIPT — same confidence cue as the log screen (what was heard) */}
            {(transcript || recording) && (
                <div className="mt-4 w-full rounded-2xl border border-slate-100 bg-white p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {recording && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />} जे ऐकलं · heard
                    </div>
                    <div className="mt-1 text-[15px] font-semibold leading-snug text-slate-700">
                        {transcript ? `"${transcript}"` : <span className="text-slate-400">बोलायला सुरुवात करा...</span>}
                    </div>
                </div>
            )}
            {err && <div className="mt-3 w-full rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-center text-sm font-bold text-red-700">{err}</div>}
            {!supported.current && <div className="mt-2 text-center text-[11px] text-slate-400">या ब्राउझरमध्ये लिखाण दिसत नाही — Chrome वापरा.</div>}
        </div>
    );
};

export default LabourMic;
