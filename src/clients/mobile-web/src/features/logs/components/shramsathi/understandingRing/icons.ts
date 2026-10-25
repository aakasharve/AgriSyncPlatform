// Shram Safal – "मला किती समजलं" icons: 64 x 64 flat two-tone SVG markup (static, trusted strings).
// Rendered with innerHTML by the engine. Keys match the day-log categories in categories.ts.
import { BRAIN_FULL } from './brain';

export type IconName = 'work' | 'labour' | 'inputs' | 'water' | 'machinery' | 'crop' | 'expenses' | 'observations' | 'reminders' | 'blockers'
  | 'understand' | 'sprout' | 'check' | 'cross' | 'leaf';

const G = '#1E9E5A', GL = '#DDF3E4', B = '#2D7FF9', BL = '#DCE9FF', O = '#F08A24', OL = '#FFE9D2';
function svg(inner: string): string { return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'; }

export const ICONS: Record<IconName, string> = {
  // झालेली कामे – clipboard with a tick
  work: svg('<rect x="15" y="12" width="30" height="40" rx="5" fill="' + GL + '" stroke="' + G + '" stroke-width="3.5"/>' +
    '<rect x="24" y="8" width="12" height="8" rx="3" fill="' + G + '"/>' +
    '<path d="M21 26h14M21 33h10" stroke="' + G + '" stroke-width="3.5"/>' +
    '<circle cx="43" cy="44" r="10" fill="' + G + '"/><path d="M38.5 44l3 3 5.5-6" stroke="#fff" stroke-width="3.2"/>'),
  // कामगार व त्यांची हजेरी – three people
  labour: svg('<circle cx="32" cy="20" r="7" fill="' + B + '"/><path d="M19 48c0-8 6-13 13-13s13 5 13 13z" fill="' + B + '"/>' +
    '<circle cx="15" cy="26" r="5.5" fill="' + BL + '" stroke="' + B + '" stroke-width="2.5"/><path d="M5 48c0-6 4-10 10-10 3 0 5 1 7 2" fill="' + BL + '" stroke="' + B + '" stroke-width="2.5"/>' +
    '<circle cx="49" cy="26" r="5.5" fill="' + BL + '" stroke="' + B + '" stroke-width="2.5"/><path d="M59 48c0-6-4-10-10-10-3 0-5 1-7 2" fill="' + BL + '" stroke="' + B + '" stroke-width="2.5"/>'),
  // खते आणि औषधे – fertiliser sack + spray bottle
  inputs: svg('<path d="M10 22h24l-3 5c5 4 6 14 4 21H9c-2-7-1-17 4-21z" fill="' + GL + '" stroke="' + G + '" stroke-width="3.2"/>' +
    '<path d="M21 44c-5 0-7-4-6-8 5 0 7 4 6 8zM21 44c3-2 5-5 4-9" stroke="' + G + '" stroke-width="2.6" fill="' + G + '" fill-opacity=".25"/>' +
    '<rect x="40" y="26" width="14" height="24" rx="3" fill="' + G + '"/><path d="M43 26v-6h8v6M51 20h5l2 3" stroke="' + G + '" stroke-width="3"/>' +
    '<rect x="43" y="33" width="8" height="8" rx="1.5" fill="#fff"/>'),
  // पाणी / सिंचन – drop and sprinkler
  water: svg('<path d="M32 6c6 8 10 13 10 19a10 10 0 0 1-20 0c0-6 4-11 10-19z" fill="' + B + '"/>' +
    '<path d="M32 40v14M24 54h16" stroke="' + B + '" stroke-width="3.5"/>' +
    '<path d="M18 40c-4 2-7 6-8 10M46 40c4 2 7 6 8 10" stroke="' + B + '" stroke-width="3" stroke-dasharray="1 5"/>' +
    '<circle cx="12" cy="38" r="2" fill="' + B + '"/><circle cx="52" cy="38" r="2" fill="' + B + '"/>'),
  // यंत्र / मशीनरी – tractor
  machinery: svg('<circle cx="20" cy="44" r="10" fill="' + GL + '" stroke="' + G + '" stroke-width="3.5"/><circle cx="20" cy="44" r="3" fill="' + G + '"/>' +
    '<circle cx="48" cy="48" r="6" fill="' + GL + '" stroke="' + G + '" stroke-width="3.2"/>' +
    '<path d="M10 36V24h18l4 12h20v8" fill="' + G + '" stroke="' + G + '" stroke-width="3.2"/><path d="M28 24V14h10v22" stroke="' + G + '" stroke-width="3.2"/>' +
    '<rect x="31" y="17" width="5" height="6" fill="#fff"/>'),
  // पिकाची अवस्था – leaf under a magnifier
  crop: svg('<path d="M14 46c0-16 10-28 28-30 0 18-11 30-28 30z" fill="' + GL + '" stroke="' + G + '" stroke-width="3.2"/><path d="M14 46c6-8 12-14 22-22" stroke="' + G + '" stroke-width="2.6"/>' +
    '<circle cx="42" cy="40" r="9" fill="#fff" stroke="' + G + '" stroke-width="3.5"/><path d="M49 47l7 7" stroke="' + G + '" stroke-width="4.5"/>'),
  // इतर खर्च – bill with ₹
  expenses: svg('<path d="M14 8h28l8 8v40l-5-3-5 3-5-3-5 3-5-3-5 3-5-3z" fill="' + BL + '" stroke="' + B + '" stroke-width="3.2"/>' +
    '<path d="M20 20h16M20 27h10" stroke="' + B + '" stroke-width="3"/>' +
    '<circle cx="40" cy="40" r="11" fill="' + B + '"/><path d="M35.5 34.5h9M35.5 38.5h9M37 34.5c5 0 5 6.5 0 6.5h-1.5l6.5 6" stroke="#fff" stroke-width="2.4"/>'),
  // निरीक्षण आणि टीप – clipboard with an eye
  observations: svg('<rect x="10" y="12" width="30" height="40" rx="5" fill="' + GL + '" stroke="' + G + '" stroke-width="3.5"/>' +
    '<rect x="19" y="8" width="12" height="8" rx="3" fill="' + G + '"/><path d="M16 26h14M16 33h9" stroke="' + G + '" stroke-width="3.2"/>' +
    '<path d="M30 46c4-6 8-9 13-9s9 3 13 9c-4 6-8 9-13 9s-9-3-13-9z" fill="#fff" stroke="' + G + '" stroke-width="3.2"/><circle cx="43" cy="46" r="4.5" fill="' + G + '"/>'),
  // आठवणीत ठेवायची कामे – bell with a clock
  reminders: svg('<path d="M30 10c-9 0-15 7-15 16v9l-5 7h40l-5-7v-9c0-9-6-16-15-16z" fill="' + B + '"/><path d="M25 46a5 5 0 0 0 10 0" fill="' + B + '"/>' +
    '<circle cx="45" cy="44" r="11" fill="#fff" stroke="' + B + '" stroke-width="3.2"/><path d="M45 38v6l4 3" stroke="' + B + '" stroke-width="3"/>'),
  // अडथळे / अडचणी – warning triangle
  blockers: svg('<path d="M32 8L58 52H6z" fill="' + OL + '" stroke="' + O + '" stroke-width="4"/><path d="M32 24v14" stroke="' + O + '" stroke-width="5"/><circle cx="32" cy="45" r="3" fill="' + O + '"/>'),
  // centre: understanding – the two-hemisphere brain (brain.ts)
  understand: BRAIN_FULL,
  sprout: svg('<path d="M32 56V30" stroke="' + G + '" stroke-width="4"/><path d="M32 36C32 24 24 16 10 16c0 13 8 20 22 20z" fill="' + G + '"/>' +
    '<path d="M32 30c0-10 7-17 20-17 0 11-7 17-20 17z" fill="#82BE1E"/><path d="M20 56h24" stroke="' + G + '" stroke-width="4"/>'),
  check: svg('<circle cx="32" cy="32" r="28" fill="' + G + '"/><path d="M20 33l8 8 16-17" stroke="#fff" stroke-width="7"/>'),
  cross: svg('<circle cx="32" cy="32" r="28" fill="#E5484D"/><path d="M22 22l20 20M42 22L22 42" stroke="#fff" stroke-width="7"/>'),
  leaf: svg('<path d="M10 54C10 28 26 10 54 10 54 38 36 54 10 54z" fill="currentColor"/><path d="M10 54c10-12 20-22 34-34" stroke="#fff" stroke-opacity=".55" stroke-width="3"/>')
};
