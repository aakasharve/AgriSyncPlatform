/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeStory — the founder's 2:18 welcome voice note, shown as kinetic Marathi
 * type with a picture track, both in step with the voice.
 *
 * WHY IT IS BUILT THIS WAY
 *  - The audio element is the only clock. Every frame reads `currentTime`, so
 *    pausing, rewinding, a slow phone or a dropped frame can never let the
 *    words drift from the voice.
 *  - React renders once per phrase / scene. The per-frame work (which word is
 *    lit, which picture has popped, section bars, the clock) is class toggles
 *    on refs, so a low-end Android phone is not re-rendering 60 times a second.
 *  - Interaction is optional and never blocks the voice: tap the phrase to hear
 *    it again, tap a picture for a small bounce, drag the bar, pause, skip.
 *  - The player is the approved V6b-A (repair R3 lane S1, founder 27 Nov 2026):
 *    at the top only the part name and a small "वगळा"; at the bottom one drag
 *    bar with a tick at each part start, the time played and the time left
 *    under it, a bubble with the part name while dragging, and ONE big play /
 *    pause button. No 10-second back / forward buttons (the founder's change).
 *  - Nobody has to find a play button. A short live intro (WelcomeIntro) runs
 *    while the file loads, then the voice starts by itself (Capacitor turns off
 *    Android's "sound needs a tap" rule). If a browser still refuses, one big
 *    "tap to listen" button appears; the voice never fails silently.
 *  - The note is played from MEMORY, not streamed from the app's own server.
 *    Capacitor's on-device server answers a ranged media request ("from byte N")
 *    with the file from byte 0 under a header claiming byte N. The player asks
 *    for ranges while it buffers and on every jump, so a streamed note stopped
 *    after a few seconds on the phone, and every jump (the drag bar today) and
 *    tap-to-replay landed on the wrong audio. One plain fetch of the whole 1.1 MB file (which
 *    that server serves correctly) into a blob: URL lets the WebView serve every
 *    range itself.
 *
 * `onDone(true)` when the note ends; `onDone(false)` when the farmer chooses to
 * move on from the skip sheet.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import welcomeNoteUrl from './assets/welcome-note.mp3';
import {
    CHAPTER_STARTS, STORY_CHAPTERS, STORY_DURATION, STORY_LINES,
    chapterIndexAt, formatClock, formatTimeLeft, introState, lineIndexAt, timeAtFraction, wordStateAt,
} from './welcomeTimeline';
import WelcomeIntro from './WelcomeIntro';
import { STORY_SCENES, sceneIndexForLine } from './welcomeScenes';
import WelcomeSkipSheet from './WelcomeSkipSheet';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import './welcomeStory.css';

interface WelcomeStoryProps {
    onDone: (listenedToEnd: boolean) => void;
    /** The owner-only line under "अभिनंदन!" (hidden for a worker or mukadam). */
    showOwnerLine?: boolean;
}

/** The new words of the V6b-A player (PROPOSED), with their English twins. Everything else on this screen is the Marathi note's own. */
const PLAYER_WORDS = {
    mr: { bar: 'संदेशात पुढे-मागे जा' },
    en: { bar: 'Move through the message' },
} as const;

/** A drag stops just short of the end, as the old 10-second jump did: reaching the very end would end the note under his finger. */
const LAST_SEEK = STORY_DURATION - 0.1;
/** A keyboard arrow on the drag bar moves this many seconds (no button on screen does). */
const KEY_STEP_SEC = 5;
const pctOf = (t: number): number => Math.max(0, Math.min(1, t / STORY_DURATION)) * 100;

const SKY: { p: number; top: number[]; mid: number[] }[] = [ // a farm day: dawn → noon → evening
    { p: 0, top: [255, 222, 186], mid: [255, 244, 230] },
    { p: 0.25, top: [214, 238, 252], mid: [244, 251, 255] },
    { p: 0.55, top: [205, 236, 252], mid: [246, 252, 249] },
    { p: 0.8, top: [255, 226, 190], mid: [255, 246, 233] },
    { p: 1, top: [250, 200, 160], mid: [255, 238, 222] },
];
function skyGradient(p: number): string {
    let i = 0;
    while (i < SKY.length - 2 && p > SKY[i + 1].p) i++;
    const a = SKY[i];
    const b = SKY[i + 1];
    const f = Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p)));
    const mix = (x: number[], y: number[]) => x.map((v, k) => Math.round(v + (y[k] - v) * f)).join(',');
    return `linear-gradient(180deg, rgb(${mix(a.top, b.top)}) 0%, rgb(${mix(a.mid, b.mid)}) 46%, #F6FCF8 74%, #EFFAF3 100%)`;
}

const WelcomeStory: React.FC<WelcomeStoryProps> = ({ onDone, showOwnerLine = true }) => {
    const [lineIdx, setLineIdx] = useState(-1);
    const [playing, setPlaying] = useState(false);
    const [needsTap, setNeedsTap] = useState(false);
    const [sheet, setSheet] = useState<{ remaining: number } | null>(null);
    const [hintGone, setHintGone] = useState(false);
    const [phase, setPhase] = useState<'intro' | 'story'>('intro');
    const [intro, setIntro] = useState({ count: 3, progress: 0, leaving: false });

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const skyRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const zoneRef = useRef<HTMLDivElement>(null);
    // The V6b-A drag bar: painted from refs every frame (no React render per frame), like the words.
    const trackRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLElement>(null);
    const thumbRef = useRef<HTMLSpanElement>(null);
    const bubbleRef = useRef<HTMLSpanElement>(null);
    const nowRef = useRef<HTMLSpanElement>(null);
    const leftRef = useRef<HTMLSpanElement>(null);
    const draggingRef = useRef(false);
    const wasPlayingRef = useRef(false);
    const [dragging, setDragging] = useState(false);
    const words = PLAYER_WORDS[useOptionalLanguage()?.language === 'en' ? 'en' : 'mr'];
    const cueNodes = useRef<{ el: Element; at: number }[]>([]);
    const levelRef = useRef<() => number>(() => 0);
    const lineRef = useRef(-1);
    const doneRef = useRef(false);
    const readyRef = useRef(false);
    const ctxRef = useRef<AudioContext | null>(null);
    const begunRef = useRef(false);
    // The latest "finished" callback, held apart from the player. The router used to hand a new one on
    // every redraw (background sync redraws every 15 s); the player set-up re-ran on it, and its
    // clean-up paused the voice: the note stopped between 0 and 15 s on every phone (R1 04-A).
    const onDoneRef = useRef(onDone);
    useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
    // What the play button shows, kept equal to the real audio state: set from the player's own events
    // AND checked every frame, so a stop without a "pause" event can never leave a wrong button.
    const playingRef = useRef(false);
    const syncPlaying = useCallback((audio: HTMLAudioElement) => {
        const now = !audio.paused;
        if (now !== playingRef.current) { playingRef.current = now; setPlaying(now); }
    }, []);

    /** The drag bar, the bubble and the two times at second `t` (class / text / attribute writes on refs only). */
    const paint = useCallback((t: number) => {
        const p = pctOf(t);
        const at = `${p}%`;
        if (fillRef.current) fillRef.current.style.width = at;
        if (thumbRef.current) thumbRef.current.style.left = at;
        const bubble = bubbleRef.current;
        if (bubble) {
            bubble.style.left = at;
            // Centred over the thumb in the middle, flush with the bar at either end, so the part name never runs off the phone.
            bubble.style.transform = `translateX(-${p}%)`;
            const part = STORY_CHAPTERS[chapterIndexAt(CHAPTER_STARTS, t)] ?? '';
            if (bubble.textContent !== part) bubble.textContent = part;
        }
        const now = formatClock(t);
        if (nowRef.current && nowRef.current.textContent !== now) nowRef.current.textContent = now;
        const left = formatTimeLeft(t, STORY_DURATION);
        if (leftRef.current && leftRef.current.textContent !== left) leftRef.current.textContent = left;
        const bar = trackRef.current;
        const sec = String(Math.floor(Math.max(0, t)));
        if (bar && bar.getAttribute('aria-valuenow') !== sec) {
            bar.setAttribute('aria-valuenow', sec);
            bar.setAttribute('aria-valuetext', now);
        }
    }, []);

    const sceneIdx = sceneIndexForLine(Math.max(0, lineIdx));
    const line = lineIdx >= 0 ? STORY_LINES[lineIdx] : null;

    /* ---- audio lifecycle: ONE player for the life of this screen ---- */
    useEffect(() => {
        const audio = new Audio();
        audio.preload = 'auto';
        audioRef.current = audio;
        let objectUrl: string | null = null;
        let cancelled = false;
        // Whole file into memory once (see the header: never stream it from the app's own server).
        fetch(welcomeNoteUrl)
            .then((r) => { if (!r.ok) throw new Error(`welcome note ${r.status}`); return r.blob(); })
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                audio.src = objectUrl;
                audio.load();
            })
            .catch(() => {
                // Last resort: stream it (plays, but jumps may misbehave on the phone's own server).
                if (cancelled) return;
                audio.src = welcomeNoteUrl;
                audio.load();
            });
        const onPlay = () => syncPlaying(audio);
        const onPause = () => syncPlaying(audio);
        const onEnded = () => {
            syncPlaying(audio);
            if (doneRef.current) return;
            doneRef.current = true;
            window.setTimeout(() => onDoneRef.current(true), 900);
        };
        const onReady = () => { readyRef.current = true; };
        audio.addEventListener('canplaythrough', onReady);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onEnded);

        // Voice loudness for the mic rings and the play-button glow. Optional:
        // if the WebView refuses an AudioContext the story still plays.
        let ctx: AudioContext | null = null;
        try {
            const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AC) {
                ctx = new AC();
                const source = ctx.createMediaElementSource(audio);
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                source.connect(analyser);
                analyser.connect(ctx.destination);
                const buf = new Uint8Array(analyser.fftSize);
                levelRef.current = () => {
                    analyser.getByteTimeDomainData(buf);
                    let sum = 0;
                    for (let k = 0; k < buf.length; k++) { const v = (buf[k] - 128) / 128; sum += v * v; }
                    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
                };
            }
        } catch {
            levelRef.current = () => 0;
        }

        ctxRef.current = ctx;

        const onHide = () => { if (document.hidden) audio.pause(); };
        document.addEventListener('visibilitychange', onHide);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            audio.removeEventListener('canplaythrough', onReady);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
            cancelled = true;
            audio.pause();
            audio.removeAttribute('src');
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            void ctx?.close().catch(() => undefined);
        };
        // Runs once (syncPlaying never changes): nothing the parent hands down may tear the player down mid-note.
    }, [syncPlaying]);

    /* ---- per-frame sync (class toggles only) ---- */
    useEffect(() => {
        let raf = 0;
        let lastSky = -1;
        const tick = () => {
            raf = requestAnimationFrame(tick);
            const audio = audioRef.current;
            if (!audio) return;
            const t = audio.currentTime;
            const li = lineIndexAt(STORY_LINES, t);
            if (li !== lineRef.current) { lineRef.current = li; setLineIdx(li); }

            const words = textRef.current?.children;
            const l = li >= 0 ? STORY_LINES[li] : null;
            if (words && l && words.length === l.words.length) {
                l.words.forEach((w, k) => {
                    const st = wordStateAt(w, t);
                    const el = words[k];
                    el.classList.toggle('said', st === 'said');
                    el.classList.toggle('now', st === 'now');
                    el.classList.toggle('hit', st !== 'ahead');
                });
            }
            for (const n of cueNodes.current) n.el.classList.toggle('on', t >= n.at);

            paint(t);
            const p = Math.min(1, t / STORY_DURATION);
            if (skyRef.current && Math.abs(p - lastSky) > 0.004) { lastSky = p; skyRef.current.style.background = skyGradient(p); }
            const level = audio.paused ? 0 : levelRef.current();
            rootRef.current?.style.setProperty('--lvl', level.toFixed(3));
            syncPlaying(audio);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [syncPlaying, paint]);

    // The bubble mounts when a drag starts: paint it at once, not a frame later.
    useLayoutEffect(() => {
        if (dragging) paint(audioRef.current?.currentTime ?? 0);
    }, [dragging, paint]);

    /* ---- after a scene mounts: collect its cue nodes ---- */
    useLayoutEffect(() => {
        cueNodes.current = Array.from(artRef.current?.querySelectorAll('[data-at]') ?? []).map((el) => ({
            el,
            at: Number((el as HTMLElement).dataset.at ?? (el as SVGElement).getAttribute('data-at')),
        }));
    }, [sceneIdx]);

    /* ---- fit: big words must never overflow the phone ---- */
    const fit = useCallback(() => {
        const text = textRef.current;
        const zone = zoneRef.current;
        if (!text || !zone) return;
        text.style.setProperty('--fit', '1');
        const avail = text.parentElement?.clientWidth ?? zone.clientWidth;
        let widest = 0;
        for (const el of Array.from(text.children)) widest = Math.max(widest, (el as HTMLElement).offsetWidth);
        const byWidth = widest > 0 ? avail / widest : 1;
        const byHeight = text.scrollHeight > 0 ? (zone.clientHeight - 44) / text.scrollHeight : 1;
        text.style.setProperty('--fit', String(Math.max(0.5, Math.min(1, byWidth, byHeight) * 0.94)));
    }, []);
    useLayoutEffect(fit, [lineIdx, fit]);
    // Widths measured in the fallback font are wrong once Noto Sans Devanagari
    // arrives, and a word that fit before can then run off the screen: re-fit.
    useEffect(() => {
        const fonts = document.fonts;
        if (!fonts) return;
        let alive = true;
        void fonts.ready.then(() => { if (alive) fit(); });
        const onLoad = () => fit();
        fonts.addEventListener?.('loadingdone', onLoad);
        return () => { alive = false; fonts.removeEventListener?.('loadingdone', onLoad); };
    }, [fit]);

    useEffect(() => {
        const art = artRef.current;
        const zone = zoneRef.current;
        if (!art || !zone || typeof ResizeObserver === 'undefined') return;
        const scaleArt = () => {
            const r = art.getBoundingClientRect();
            if (r.height) art.style.setProperty('--vs', Math.max(0.5, Math.min(1.15, r.height / 310, r.width / 350)).toFixed(3));
        };
        scaleArt();
        const ro = new ResizeObserver(() => { scaleArt(); fit(); });
        ro.observe(art);
        ro.observe(zone);
        return () => ro.disconnect();
    }, [fit]);

    /* ---- controls ---- */
    const play = useCallback(() => {
        const a = audioRef.current;
        if (!a) return;
        void ctxRef.current?.resume().catch(() => undefined);
        try {
            const p = a.play();
            if (p && typeof p.then === 'function') p.then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
        } catch {
            setNeedsTap(true);
        }
    }, []);
    const begin = useCallback(() => {
        if (begunRef.current) return;
        begunRef.current = true;
        setIntro((s) => ({ ...s, count: 0, progress: 1, leaving: true }));
        play();
        window.setTimeout(() => setPhase('story'), 550);
    }, [play]);
    const toggle = () => { const a = audioRef.current; if (!a) return; if (a.paused) play(); else a.pause(); };
    const seekTo = (t: number) => { const a = audioRef.current; if (a) { a.currentTime = Math.max(0, t); doneRef.current = false; } };

    /* ---- the drag bar (V6b-A): the voice waits while he drags, moves with his finger, and plays on after if it was playing ---- */
    const scrubTo = (t: number) => { const at = Math.max(0, Math.min(LAST_SEEK, t)); seekTo(at); paint(at); };
    const timeAtX = (clientX: number): number => {
        const r = trackRef.current?.getBoundingClientRect();
        return timeAtFraction(r && r.width > 0 ? (clientX - r.left) / r.width : 0, STORY_DURATION);
    };
    const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
        const a = audioRef.current;
        if (!a) return;
        e.preventDefault();
        // Keep the drag when the finger slides off the thin bar (released by the browser on pointerup).
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* an unknown pointer: the drag still works on the bar */ }
        draggingRef.current = true;
        wasPlayingRef.current = !a.paused;
        a.pause();
        scrubTo(timeAtX(e.clientX));
        setDragging(true);
    };
    const onBarMove = (e: React.PointerEvent<HTMLDivElement>) => { if (draggingRef.current) scrubTo(timeAtX(e.clientX)); };
    const onBarUp = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        setDragging(false);
        if (wasPlayingRef.current) play();
    };
    const onBarKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? KEY_STEP_SEC : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -KEY_STEP_SEC : 0;
        const a = audioRef.current;
        if (!step || !a) return;
        e.preventDefault();
        scrubTo(a.currentTime + step);
    };
    const replayLine = () => {
        if (!line) return;
        setHintGone(true);
        seekTo(line.t0 - 0.05);
        if (audioRef.current?.paused) play();
    };
    const openSkip = () => {
        const a = audioRef.current;
        a?.pause();
        setSheet({ remaining: STORY_DURATION - (a?.currentTime ?? 0) });
    };

    /* ---- intro: count down while the file loads, then start by itself ---- */
    const introElapsed = useRef(0);
    useEffect(() => {
        if (phase !== 'intro' || sheet || begunRef.current) return;
        const startedAt = performance.now() - introElapsed.current;
        const id = window.setInterval(() => {
            introElapsed.current = performance.now() - startedAt;
            const st = introState(introElapsed.current, readyRef.current);
            if (st.shouldStart) { window.clearInterval(id); begin(); return; }
            setIntro((s) => (s.count === st.count && Math.abs(s.progress - st.progress) < 0.02 ? s : { ...s, count: st.count, progress: st.progress }));
        }, 100);
        return () => window.clearInterval(id);
    }, [phase, sheet, begin]);
    const poke = (e: React.PointerEvent) => {
        const el = (e.target as Element).closest('.ws-tap');
        if (!el) return;
        el.classList.remove('poke');
        void (el as HTMLElement).getBoundingClientRect();
        el.classList.add('poke');
        window.setTimeout(() => el.classList.remove('poke'), 480);
        navigator.vibrate?.(12);
    };

    const Scene = STORY_SCENES[sceneIdx].art;
    const showHint = !hintGone && lineIdx >= 1 && lineIdx <= 3;

    return (
        <div ref={rootRef} className="ws-root" lang="mr" data-testid="welcome-story">
            <div ref={skyRef} className="ws-sky" style={{ background: skyGradient(0) }} />
            <svg className="ws-hills" viewBox="0 0 1440 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
                <path d="M0,150 C260,96 520,178 760,140 C1000,104 1240,176 1440,124 L1440,300 L0,300 Z" fill="#d1fae5" />
                <path d="M0,196 C300,150 620,222 920,186 C1140,160 1320,206 1440,186 L1440,300 L0,300 Z" fill="#a7f3d0" />
                <path d="M0,236 C360,204 720,250 1080,228 C1260,216 1380,240 1440,230 L1440,300 L0,300 Z" fill="#6ee7b7" />
            </svg>

            <div className="ws-top">
                <div className="ws-bar">
                    <span className="ws-title" data-testid="welcome-part-name">{STORY_CHAPTERS[line?.chapter ?? 0]}</span>
                    {phase === 'story' && (
                        <button type="button" className="ws-skip" data-testid="welcome-story-skip" onClick={openSkip}>वगळा</button>
                    )}
                </div>
            </div>

            <div className="ws-stagebox">
                <div ref={artRef} className="ws-art" onPointerDown={poke} aria-hidden="true">
                    <div key={sceneIdx} className="ws-scene"><div className="ws-sc">{Scene()}</div></div>
                </div>
                <div ref={zoneRef} className="ws-textzone">
                    <button type="button" className="ws-ktbtn" onClick={replayLine} aria-label={line ? `${line.text} — पुन्हा ऐका` : 'संदेश सुरू होत आहे'}>
                        <div ref={textRef} key={lineIdx} className="ws-kt">
                            {line?.words.map((w, k) => (
                                <span
                                    key={k}
                                    className={`ws-w ${w.size}${w.tone ? ` t-${w.tone}` : ' plain'}${w.fx ? ` fx-${w.fx}` : ''}`}
                                >
                                    {w.text}
                                </span>
                            ))}
                        </div>
                    </button>
                    {showHint && <span className="ws-hint">ओळीवर टॅप करा, ती पुन्हा ऐका</span>}
                </div>
                {needsTap && phase === 'story' && (
                    <button type="button" className="ws-tapgate" data-testid="welcome-tap-to-listen" onClick={play}>
                        <span><Play size={22} fill="currentColor" /> ऐकायला इथे टॅप करा</span>
                    </button>
                )}
            </div>

            <div className="ws-bottom">
                <div className="ws-player" data-testid="welcome-player">
                    <div
                        ref={trackRef}
                        className={`ws-track${dragging ? ' drag' : ''}`}
                        role="slider"
                        tabIndex={0}
                        aria-label={words.bar}
                        lang={words === PLAYER_WORDS.en ? 'en' : undefined}
                        aria-valuemin={0}
                        aria-valuemax={Math.floor(STORY_DURATION)}
                        aria-valuenow={0}
                        aria-valuetext={formatClock(0)}
                        onPointerDown={onBarDown}
                        onPointerMove={onBarMove}
                        onPointerUp={onBarUp}
                        onPointerCancel={onBarUp}
                        onLostPointerCapture={onBarUp}
                        onKeyDown={onBarKey}
                    >
                        <span className="ws-rail"><i ref={fillRef} className="ws-fill" /></span>
                        {CHAPTER_STARTS.slice(1).map((start) => (
                            <span key={start} className="ws-tick" data-testid="welcome-track-tick" style={{ left: `${pctOf(start)}%` }} />
                        ))}
                        <span ref={thumbRef} className="ws-thumb" />
                        {dragging && <span ref={bubbleRef} className="ws-bub" data-testid="welcome-track-bubble" />}
                    </div>
                    <div className="ws-times">
                        <span ref={nowRef} data-testid="welcome-time-now">0:00</span>
                        <span ref={leftRef} data-testid="welcome-time-left">{formatTimeLeft(0, STORY_DURATION)}</span>
                    </div>
                    <div className="ws-btns">
                        <button type="button" className="ws-ctl big" aria-label={playing ? 'थांबवा' : 'ऐका'} onClick={toggle}>
                            {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
                        </button>
                    </div>
                </div>
            </div>

            {phase === 'intro' && (
                <WelcomeIntro
                    count={intro.count}
                    progress={intro.progress}
                    leaving={intro.leaving}
                    showOwnerLine={showOwnerLine}
                    onSkip={openSkip}
                />
            )}

            <WelcomeSkipSheet
                open={sheet !== null}
                remainingSec={sheet?.remaining ?? STORY_DURATION}
                started={begunRef.current}
                onStay={() => { setSheet(null); if (begunRef.current) play(); else begin(); }}
                onLeave={() => { setSheet(null); doneRef.current = true; onDoneRef.current(false); }}
            />
        </div>
    );
};

export default WelcomeStory;
