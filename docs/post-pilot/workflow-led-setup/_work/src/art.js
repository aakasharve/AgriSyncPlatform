/* ===== small helpers, icons, drawn pictures (inline SVG only, no emoji) ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const DIG = '०१२३४५६७८९';
const dv = (x) => String(x).replace(/\d/g, d => DIG[d]);
const MONTHS = ['जानेवारी','फेब्रुवारी','मार्च','एप्रिल','मे','जून','जुलै','ऑगस्ट','सप्टेंबर','ऑक्टोबर','नोव्हेंबर','डिसेंबर'];
const ART = (name) => { const a = document.getElementById('asset-' + name); return a ? a.getAttribute('src') : ''; };
const NUMW = ['शून्य','एक','दोन','तीन','चार','पाच','सहा','सात'];

const P = {
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  bksp: '<path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/>',
  spk: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6zM12 14c0-3 2.5-5 6-5 0 3-2.5 5-6 5z"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  cut: '<path d="M7 7l10 10M17 7L7 17"/>',
  tractor: '<circle cx="7" cy="16.5" r="3.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="M3 16.5V8h8l2 4h6v5.5M11 8V5h3"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  book: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 5a3.5 3.5 0 0 1 0 6.5M18 14.8c2 .6 3.2 2.3 3.5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10M12 10V4.5a1.5 1.5 0 0 1 3 0V10M15 10V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6.5 7S6 18.5 5 15l-1.4-3a1.5 1.5 0 0 1 2.6-1.4L9 14"/>'
};
const ic = (n, s = 24, sw = 2.2) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

/* calm line pictures, 96 x 72 */
const SK = 'stroke="#065F46" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const scene = (inner) => `<svg class="art" viewBox="0 0 96 72" aria-hidden="true"><rect width="96" height="72" rx="14" fill="#ECFDF5"/><path d="M0 50q24-9 48-3t48-2v27H0z" fill="#D1FAE5"/>${inner}</svg>`;
const WATERART = {
  Well: scene(`<ellipse cx="48" cy="46" rx="22" ry="7" fill="#fff" ${SK}/><path d="M26 46v7c0 4 10 7 22 7s22-3 22-7v-7" fill="#fff" ${SK}/><path d="M30 43V20M66 43V20M27 20h42" fill="none" ${SK}/><path d="M48 20v11" ${SK} fill="none"/><rect x="43.5" y="31" width="9" height="8" rx="2" fill="#A7F3D0" ${SK}/>`),
  Borewell: scene(`<rect x="44" y="18" width="8" height="40" rx="1" fill="#fff" ${SK}/><rect x="40" y="13" width="16" height="7" rx="2" fill="#fff" ${SK}/><path d="M52 25h16v8" fill="none" ${SK}/><path d="M68 38c-3.5 4.5-3.5 7 0 7s3.5-2.5 0-7z" fill="#A7F3D0" ${SK}/><path d="M16 64q6-4 12 0t12 0 12 0 12 0 12 0" fill="none" ${SK} opacity=".7"/>`),
  Canal: scene(`<path d="M0 40L32 29H64L96 40V72H0z" fill="#D1FAE5"/><path d="M18 46L35 37H61L78 46V56H18z" fill="#A7F3D0" ${SK}/><path d="M28 47q5-3 10 0t10 0 10 0 10 0" fill="none" ${SK} opacity=".7"/><path d="M0 40L32 29H64L96 40" fill="none" ${SK}/>`),
  'Farm Pond': scene(`<path d="M8 43q0-14 17-17h46q17 3 17 17" fill="none" ${SK} opacity=".55"/><path d="M14 44q0-10 12-12h44q12 2 12 12t-12 12H26q-12-2-12-12z" fill="#A7F3D0" ${SK}/><path d="M32 44q4-3 8 0t8 0 8 0 8 0" fill="none" ${SK} opacity=".7"/>`),
  Tanker: scene(`<rect x="10" y="26" width="50" height="26" rx="13" fill="#A7F3D0" ${SK}/><path d="M62 33h13l9 10v9H62z" fill="#fff" ${SK}/><path d="M35 33c-3 4-3 6 0 6s3-2 0-6z" fill="#fff" ${SK}/><circle cx="26" cy="56" r="5.5" fill="#065F46"/><circle cx="46" cy="56" r="5.5" fill="#065F46"/><circle cx="76" cy="56" r="5.5" fill="#065F46"/>`)
};
const POWERART = {
  MSEB: scene(`<path d="M40 60V16M58 60V16M32 24h34M34 34h30" fill="none" ${SK}/><path d="M12 30q12 8 22 4M66 34q12-4 20 4" fill="none" ${SK} opacity=".6"/><path d="M40 60L58 16M58 60L40 16" fill="none" ${SK} opacity=".5"/>`),
  Solar: scene(`<circle cx="30" cy="24" r="8" fill="#FDE68A" stroke="#B45309" stroke-width="2"/><path d="M30 8v5M30 35v5M14 24h5M41 24h5M19 13l3 3M38 32l3 3M41 13l-3 3M19 35l3-3" stroke="#B45309" stroke-width="2" stroke-linecap="round"/><path d="M40 56l6-18h36l-6 18z" fill="#A7F3D0" ${SK}/><path d="M52 38l-3 18M66 38l-3 18M43 47h38" fill="none" ${SK} opacity=".6"/>`),
  Generator: scene(`<rect x="26" y="26" width="44" height="28" rx="6" fill="#fff" ${SK}/><path d="M38 26v-6h20v6" fill="none" ${SK}/><path d="M34 40h28" ${SK} fill="none"/><circle cx="36" cy="58" r="4" fill="#065F46"/><circle cx="60" cy="58" r="4" fill="#065F46"/><path d="M48 31l-4 7h8l-4 7" fill="none" ${SK}/>`)
};
const PHASEART = {
  1: scene(`<path d="M14 40q8.5-20 17 0t17 0 17 0 17 0" fill="none" stroke="#065F46" stroke-width="3" stroke-linecap="round"/>`),
  3: scene(`<path d="M14 30q8.5-14 17 0t17 0 17 0 17 0" fill="none" stroke="#065F46" stroke-width="2.6" stroke-linecap="round"/><path d="M14 40q8.5-14 17 0t17 0 17 0 17 0" fill="none" stroke="#10B981" stroke-width="2.6" stroke-linecap="round"/><path d="M14 50q8.5-14 17 0t17 0 17 0 17 0" fill="none" stroke="#6EE7B7" stroke-width="2.6" stroke-linecap="round"/>`)
};
const QRART = (() => {
  /* a DRAWING that looks like a code but is not one: three corner marks and a pseudo-random pattern */
  let s = '<svg class="qr" viewBox="0 0 21 21" aria-label="नमुना QR" role="img"><rect width="21" height="21" rx="2" fill="#fff"/>';
  const mark = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#1C1917"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#1C1917"/>`;
  s += mark(0, 0) + mark(14, 0) + mark(0, 14);
  let seed = 7;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) continue;
    seed = (seed * 9301 + 49297) % 233280;
    if (seed / 233280 > 0.52) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#1C1917"/>`;
  }
  return s + '</svg>';
})();
