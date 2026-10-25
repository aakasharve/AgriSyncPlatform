// The "समजलं" brain at the heart of the ring – drawn as two layers so the engine can fill it with colour from the
// bottom up as the farmer's day is understood: BRAIN_EMPTY (pale glass) underneath, BRAIN_FULL (the app's
// green → teal → blue ramp) clipped to the fill level on top. Front view: left hemisphere green, right blue,
// the same two colours the ring runs through. viewBox 120 × 104; BRAIN_SPARKS are synapse points in that box.

const VIEW = 'viewBox="0 0 120 104" xmlns="http://www.w3.org/2000/svg"';

// one hemisphere (left); the right is its mirror
export const BRAIN_LOBE = 'M57.5 13C52 6.5 41 6 35.5 11.5 27.5 9.5 19 15 18.5 24 10.5 27 7 36.5 11 44.5 5 50.5 6 62 13.5 67 12.5 76.5 20 84 29 84.5'
  + 'C33 92 43.5 95.5 51 91 54 94 57.5 93.5 57.5 93.5Z';
const LOBE = BRAIN_LOBE;
const FOLDS = [
  'M35.5 11.5c.5 5 4.5 8.5 9.5 8.5 4.5 0 7.5 3 7.5 7.5',
  'M18.5 24c5.5 1 8.5 5.5 7.5 11 4.5 1.5 6 6 4 10',
  'M11 44.5c5-1.5 10 .5 12.5 5 2.5 4 7.5 5 11.5 2.5',
  'M13.5 67c4-3.5 9.5-3.5 13 0 3-3 8-3 10.5.5',
  'M29 84.5c-.5-5 3-9.5 8-10.5 4.5-1 7-5 6-9.5',
  'M51 91c-2.5-4-1.5-8.5 2-11',
  'M38.5 33c4.5-1.5 9.5 1 11 5.5',
  'M44.5 52c3.5-1.5 7.5 0 9 3.5',
];

function hemi(fill: string, stroke: string, fold: string, foldW: number, mirror: boolean): string {
  const tf = mirror ? ' transform="translate(120 0) scale(-1 1)"' : '';
  return `<g${tf}><path d="${LOBE}" fill="${fill}" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round"/>`
    + FOLDS.map((d) => `<path d="${d}" fill="none" stroke="${fold}" stroke-width="${foldW}" stroke-linecap="round"/>`).join('') + '</g>';
}

export const BRAIN_EMPTY = `<svg ${VIEW}>`
  + hemi('#F1F7F3', '#B4C7BB', '#CCDAD1', 2.4, false) + hemi('#F1F7F3', '#B4C7BB', '#CCDAD1', 2.4, true) + '</svg>';

export const BRAIN_FULL = `<svg ${VIEW}><defs>`
  + '<linearGradient id="ssbL" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#4FD18B"/><stop offset=".55" stop-color="#1FA85C"/><stop offset="1" stop-color="#12A3A0"/></linearGradient>'
  + '<linearGradient id="ssbR" x1="1" y1="0" x2="0.1" y2="1"><stop offset="0" stop-color="#5FA2FF"/><stop offset=".55" stop-color="#2D6FF0"/><stop offset="1" stop-color="#13A8A0"/></linearGradient>'
  + '<radialGradient id="ssbG" cx=".32" cy=".22" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
  + '<linearGradient id="ssbD" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#06301F" stop-opacity="0"/><stop offset="1" stop-color="#06301F" stop-opacity=".22"/></linearGradient>'
  + '</defs>'
  + hemi('url(#ssbL)', '#127A45', 'rgba(255,255,255,.78)', 2.6, false) + hemi('url(#ssbR)', '#1C4FB8', 'rgba(255,255,255,.78)', 2.6, true)
  + `<path d="${LOBE}" fill="url(#ssbG)"/>`
  + `<path d="${LOBE}" fill="url(#ssbG)" opacity=".7" transform="translate(120 0) scale(-1 1)"/>`
  + `<path d="${LOBE}" fill="url(#ssbD)"/><path d="${LOBE}" fill="url(#ssbD)" transform="translate(120 0) scale(-1 1)"/>`
  + '</svg>';

/** Synapse points (viewBox units) that spark as the brain takes in each told item. */
export const BRAIN_SPARKS: [number, number][] = [
  [38, 26], [26, 44], [20, 60], [42, 64], [33, 78], [50, 48], [48, 30],
  [82, 26], [94, 44], [100, 60], [78, 64], [87, 78], [70, 48], [72, 30],
];
export const BRAIN_W = 120, BRAIN_H = 104;
