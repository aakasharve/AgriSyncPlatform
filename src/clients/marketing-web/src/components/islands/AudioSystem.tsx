import { useEffect, useRef, useState } from 'react';

function createBrownNoise(ctx: AudioContext): AudioBufferSourceNode {
  const size = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;

  for (let i = 0; i < size; i += 1) {
    const white = Math.random() * 2 - 1;
    data[i] = (last + 0.02 * white) / 1.02;
    last = data[i];
    data[i] *= 3.2;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

function playSparrowChirp(ctx: AudioContext, master: GainNode) {
  const start = ctx.currentTime;
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();

  filter.type = 'highpass';
  filter.frequency.value = 1800;
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(2400, start);
  osc.frequency.exponentialRampToValueAtTime(4200, start + 0.08);
  osc.frequency.exponentialRampToValueAtTime(2800, start + 0.16);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.04, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  osc.start(start);
  osc.stop(start + 0.22);
}

function playBullockBell(ctx: AudioContext, master: GainNode) {
  const start = ctx.currentTime;
  const gain = ctx.createGain();
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();

  oscA.type = 'triangle';
  oscB.type = 'sine';
  oscA.frequency.setValueAtTime(640, start);
  oscB.frequency.setValueAtTime(960, start);
  oscA.frequency.exponentialRampToValueAtTime(420, start + 1.2);
  oscB.frequency.exponentialRampToValueAtTime(760, start + 1.2);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.07, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);

  oscA.connect(gain);
  oscB.connect(gain);
  gain.connect(master);

  oscA.start(start);
  oscB.start(start);
  oscA.stop(start + 1.45);
  oscB.stop(start + 1.45);
}

export default function AudioSystem() {
  const [active, setActive] = useState(false);
  const [visible, setVisible] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const windGainRef = useRef<GainNode | null>(null);
  const windSpeedRef = useRef(0.3);
  const initialized = useRef(false);
  const sparrowTimer = useRef(0);
  const bellTimer = useRef(0);

  useEffect(() => {
    const isMobile = window.innerWidth < 1024 || 'ontouchstart' in window;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setVisible(!isMobile && !reduced);
  }, []);

  useEffect(() => {
    const handleWind = (event: Event) => {
      const speed = (event as CustomEvent<number>).detail;
      windSpeedRef.current = speed;

      if (windGainRef.current && ctxRef.current) {
        windGainRef.current.gain.setTargetAtTime(0.015 + speed * 0.045, ctxRef.current.currentTime, 0.5);
      }
    };

    window.addEventListener('windspeed', handleWind);
    return () => window.removeEventListener('windspeed', handleWind);
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(sparrowTimer.current);
      window.clearTimeout(bellTimer.current);
      ctxRef.current?.close();
    };
  }, []);

  async function initAudio() {
    if (initialized.current) return;
    initialized.current = true;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    masterRef.current = master;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.015 + windSpeedRef.current * 0.045;
    windGain.connect(master);
    windGainRef.current = windGain;

    const noise = createBrownNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    noise.connect(filter);
    filter.connect(windGain);
    noise.start();

    const loopSparrow = () => {
      sparrowTimer.current = window.setTimeout(() => {
        if (ctxRef.current?.state === 'running' && masterRef.current) {
          playSparrowChirp(ctxRef.current, masterRef.current);
          window.setTimeout(() => {
            if (ctxRef.current?.state === 'running' && masterRef.current) {
              playSparrowChirp(ctxRef.current, masterRef.current);
            }
          }, 120);
        }
        loopSparrow();
      }, 25000 + Math.random() * 20000);
    };

    const loopBell = () => {
      bellTimer.current = window.setTimeout(() => {
        if (ctxRef.current?.state === 'running' && masterRef.current) {
          playBullockBell(ctxRef.current, masterRef.current);
        }
        loopBell();
      }, 120000);
    };

    loopSparrow();
    loopBell();
  }

  async function handleToggle() {
    if (!active) {
      await initAudio();
      await ctxRef.current?.resume();
      setActive(true);
      return;
    }

    await ctxRef.current?.suspend();
    setActive(false);
  }

  if (!visible) return null;

  return (
    <button
      id="audio-toggle"
      onClick={handleToggle}
      aria-label={active ? 'Mute farm sounds' : 'Play farm sounds'}
      aria-pressed={active}
      title={active ? 'Mute' : 'Farm sounds (शेत ध्वनी)'}
    >
      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true">
        <path
          d="M7 20 C5 18 4.5 14 5.5 10.5 C6.5 7 9.5 5 13.5 5 C17.5 5 20.5 7 21.5 10.5 C22.5 14 20.5 18 18 20 C15.5 22 10 22 7 20 Z"
          stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round"
        />
        <path
          d="M13.5 5 C13 8 12 12 13.5 16 C14.5 18.5 17 20 19.5 19.5"
          stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"
        />
        <path
          d="M7 20 L5.5 24 M5.5 24 L9 23"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        />
        {active && (
          <>
            <line x1="23" y1="9" x2="25.5" y2="7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.9" />
            <line x1="24" y1="13" x2="26.5" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
            <line x1="23" y1="17" x2="25.5" y2="18.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
          </>
        )}
      </svg>
    </button>
  );
}
