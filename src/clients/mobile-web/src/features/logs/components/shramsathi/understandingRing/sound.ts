// Soft optional sounds for the reward animation (WebAudio, no files): reel ticks, a note per landed point
// (rising), a low note per missed item, and a chime when the score locks. Off by default.
export function makeSound() {
  let ctx: AudioContext | null = null;
  const ensure = () => {
    if (!ctx) {
      const A = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (A) ctx = new A();
    }
    return ctx;
  };
  const tone = (freq: number, dur: number, vol: number, type: OscillatorType = 'sine') => {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur + 0.02);
  };
  return {
    unlock: () => { const c = ensure(); if (c && c.state === 'suspended') void c.resume(); },
    tick: () => tone(1320, 0.03, 0.022, 'triangle'),
    land: (k: number) => tone(523.25 * Math.pow(2, k / 12), 0.26, 0.06),
    miss: () => tone(330, 0.3, 0.03),
    chime: () => [0, 4, 7, 12].forEach((s, i) => setTimeout(() => tone(523.25 * Math.pow(2, s / 12), 0.7, 0.05), i * 90)),
    close: () => { if (ctx) void ctx.close(); ctx = null; },
  };
}
export type Sound = ReturnType<typeof makeSound>;
