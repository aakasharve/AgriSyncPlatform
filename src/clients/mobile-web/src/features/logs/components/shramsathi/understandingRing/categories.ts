// The day-log categories shown around the "मला किती समजलं" ring, clockwise from the top.
// Labels follow the founder's design; hints are spoken examples shown when a missed node is tapped.
import type { IconName } from './icons';

export type CategoryId =
  | 'work' | 'labour' | 'inputs' | 'water' | 'machinery' | 'cropNote' | 'expenses' | 'observations' | 'reminders' | 'blockers';

/** told = the farmer said it today · missed = it applied today but was not told · neutral = not applicable (grey, never red) */
export type NodeState = 'told' | 'missed' | 'neutral';
export type Tone = 'g' | 'b' | 'o';

export interface CategoryMeta { id: CategoryId; label: string; tone: Tone; icon: IconName; hint: string }

export const CATEGORY_META: Record<CategoryId, CategoryMeta> = {
  work:         { id: 'work',         label: 'झालेली कामे',              tone: 'g', icon: 'work',         hint: 'उदा. “आज G1 मध्ये छाटणी केली”' },
  labour:       { id: 'labour',       label: 'कामगार व<br>त्यांची हजेरी',  tone: 'b', icon: 'labour',       hint: 'उदा. “आज सहा बाया आल्या”' },
  inputs:       { id: 'inputs',       label: 'खते आणि<br>औषधे',          tone: 'g', icon: 'inputs',       hint: 'उदा. “G2 ला फवारणी केली”' },
  water:        { id: 'water',        label: 'पाणी / सिंचन',             tone: 'b', icon: 'water',        hint: 'उदा. “ऊस S1 ला तीन तास पाणी दिलं”' },
  machinery:    { id: 'machinery',    label: 'यंत्र / मशीनरी',            tone: 'g', icon: 'machinery',    hint: 'उदा. “ट्रॅक्टरने रोटर मारला”' },
  cropNote:     { id: 'cropNote',     label: 'पीक निरीक्षण /<br>विशेष बाब', tone: 'g', icon: 'crop',       hint: 'उदा. “G1 मध्ये घडांवर डाग दिसले”' },
  expenses:     { id: 'expenses',     label: 'इतर खर्च',                 tone: 'b', icon: 'expenses',     hint: 'उदा. “डिझेलला पाचशे रुपये गेले”' },
  observations: { id: 'observations', label: 'निरीक्षण<br>आणि टीप',      tone: 'g', icon: 'observations', hint: 'उदा. “बागेत अळी दिसली, लक्ष ठेवायचं”' },
  reminders:    { id: 'reminders',    label: 'आठवणीत<br>ठेवायची कामे',   tone: 'b', icon: 'reminders',    hint: 'उदा. “परवा खताची गाडी येणार”' },
  blockers:     { id: 'blockers',     label: 'अडथळे /<br>अडचणी',         tone: 'o', icon: 'blockers',     hint: 'उदा. “पाऊस आला, फवारणी थांबली”' },
};

/** Clockwise from the top. 'blockers' (अडथळे / अडचणी) is shown ONLY when the day's log mentions one – it is never
 *  a default node and never "missed" (founder, 2026-10-25); drop it from the list when it was not told. */
export const ORDER: CategoryId[] = ['work', 'labour', 'inputs', 'water', 'machinery', 'cropNote', 'expenses', 'observations', 'reminders', 'blockers'];
export const ONLY_WHEN_TOLD: ReadonlySet<CategoryId> = new Set(['blockers']);

export interface RingNodeData { id: CategoryId; label: string; state: NodeState; tone: Tone; hint: string; icon: IconName }

/** The ring's nodes in ORDER from each category's state for the day. Categories without a state are left out, and
 *  ONLY_WHEN_TOLD ones (अडथळे / अडचणी) appear only when told. */
export function buildNodes(states: Partial<Record<CategoryId, NodeState>>): RingNodeData[] {
  return ORDER.filter((id) => states[id] !== undefined && (!ONLY_WHEN_TOLD.has(id) || states[id] === 'told'))
    .map((id) => ({ ...CATEGORY_META[id], state: states[id] as NodeState }));
}
