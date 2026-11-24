/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 6) — the calm step list after stop, as a pure model.
 *
 * आवाज जतन केला → शब्द लिहून घेतले → कामं वेगळी केली → प्लॉट तपासला → औषध आणि खत ओळखले → जतन झालं.
 * Every tick is a REAL event of the save path, read from `voiceJourneySignal` (P4): no timer, no percentage, and no step
 * depends on the clock. What the steps show (his first words, the part chips, the product chips with their type) is built
 * ONLY from existing code: the save's own factory (`previewLogs`) and the result screen's own models
 * (`partEntriesOf` / `entryText`, `productBoxesOf` / `productName`, `identityOf` / `typeKeyOf`) — nothing re-derived here.
 */
import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope } from '../../../../types';
import type { VoiceJourneySnapshot } from '../../../../infrastructure/voice/voiceJourneySignal';
import { previewLogs } from '../checkSave/checkSaveModel';
import { partEntriesOf, primaryOf, type PartKey } from '../voiceResult/resultModel';
import { entryText, partNameIn } from '../voiceResult/partNames';
import { productBoxesOf, productName } from '../voiceResult/productModel';
import { identityOf, typeKeyOf, type TypeKey } from '../voiceResult/inputIdentityModel';
import { resultCopy } from '../voiceResult/resultCopy';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';

/** A journey that started more than this before the screen appeared belongs to an earlier recording (spec §3). */
export const STALE_MS = 2000;
/** How many of his words the "शब्द लिहून घेतले" line repeats. */
const EXCERPT_WORDS = 8;

export type JourneyStepKey = 'kept' | 'words' | 'parts' | 'place' | 'products' | 'saved';
export type JourneyStepState = 'done' | 'active' | 'waiting' | 'skipped';

/**
 * One chip under a step: the part it belongs to (its icon) and what was understood. A product chip also carries its name
 * and type, read from the same identity as `text`, so the approved design can colour it by type and show the name in bold.
 */
export interface JourneyChip { part: PartKey; text: string; product?: { name: string; typeName: string; type: TypeKey } }

export interface JourneyFacts {
    /** His first words as transcribed, or null when the answer carried none. */
    excerpt: string | null;
    parts: JourneyChip[];
    products: JourneyChip[];
    /** The plot(s) the save is built on (the place he chose), for the "प्लॉट तपासला" line; empty when none is named. */
    places: string[];
}

export interface JourneyStep {
    key: JourneyStepKey;
    state: JourneyStepState;
    label: string;
    sub?: string;
    chips?: JourneyChip[];
}

export interface JourneyView {
    steps: JourneyStep[];
    /** done / drawn steps (a skipped step is not counted): it moves in whole steps only. */
    progress: number;
    /** Every drawn step done: the save is on the phone. */
    complete: boolean;
}

const NO_FACTS: JourneyFacts = { excerpt: null, parts: [], products: [], places: [] };

/** The journey this screen may show: null when there is none, or it began before the screen (an earlier recording). */
export function liveJourney(snapshot: VoiceJourneySnapshot | null, mountedAt: number): VoiceJourneySnapshot | null {
    return snapshot && snapshot.startedAt >= mountedAt - STALE_MS ? snapshot : null;
}

const excerptOf = (transcript: string | undefined): string | null => {
    const words = (transcript ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return words.length > EXCERPT_WORDS ? `${words.slice(0, EXCERPT_WORDS).join(' ')} …` : words.join(' ');
};

const unique = (chips: JourneyChip[]): JourneyChip[] => {
    const seen = new Set<string>();
    return chips.filter(c => {
        const k = `${c.part}|${c.text}`;
        if (!c.text || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
};

/**
 * What the answer understood, for the chips: built through the save's own factory on the place he chose (never saved),
 * then read with the result screen's models. The sprays and fertilisers are named once, under their own step; under the
 * parts step they are the part's name. One plot's log stands for all (the same parse on several plots is the same words).
 */
export function journeyFactsOf(
    draft: AgriLogResponse | undefined, scope: LogScope | null, crops: CropProfile[], profile: FarmerProfile, language: string | null | undefined,
): JourneyFacts {
    if (!draft) return NO_FACTS;
    const logs = previewLogs(draft, scope, crops, profile);
    const primary = primaryOf(logs);
    const excerpt = excerptOf(draft.fullTranscript);
    const places = [...new Set(logs.flatMap(l => (l.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? [])).filter(Boolean))];
    if (!primary) return { ...NO_FACTS, excerpt, places };
    const parts = unique(partEntriesOf(primary, language, true).map(e => ({
        part: e.part,
        text: e.part === 'inputs' ? partNameIn('inputs', language) : entryText(e, language, true) || partNameIn(e.part, language),
    })));
    const typeNames = resultCopy(language ?? undefined).typeNames;
    const products = unique(productBoxesOf(primary).flatMap(box => box.items.map(item => {
        const name = productName(item, language);
        const type = typeKeyOf(identityOf(item));
        return { part: 'inputs' as const, text: name ? `${name} · ${typeNames[type]}` : '', product: { name, typeName: typeNames[type], type } };
    })));
    return { excerpt, parts, products, places };
}

/** The ordered steps for this journey (null = none yet). Exactly one step is active: the first one not done. */
export function journeyStepsOf(journey: VoiceJourneySnapshot | null, facts: JourneyFacts, language: string | null | undefined): JourneyView {
    const w = voiceFlowWords(language);
    const understood = journey?.understoodAt !== undefined;
    const typed = journey?.input === 'text';
    const seconds = !typed && journey?.durationMs !== undefined && journey.durationMs > 0 ? Math.round(journey.durationMs / 1000) : undefined;
    type Draft = Omit<JourneyStep, 'state'> & { state: 'done' | 'skipped' | 'pending' };
    const drafts: Draft[] = [
        {
            key: 'kept', label: typed ? w.stepKeptTyped : w.stepKept, state: journey?.keptAt !== undefined ? 'done' : 'pending',
            ...(seconds !== undefined && { sub: w.keptSub(seconds) }),
        },
        {
            key: 'words', label: w.stepWords, state: understood ? (facts.excerpt ? 'done' : 'skipped') : 'pending',
            ...(understood && facts.excerpt && { sub: facts.excerpt }),
        },
        { key: 'parts', label: w.stepParts, state: understood ? 'done' : 'pending', ...(understood && facts.parts.length > 0 && { chips: facts.parts }) },
        {
            key: 'place', label: w.stepPlace, state: journey?.place === 'same' ? 'done' : 'pending',
            ...(journey?.place === 'same' && facts.places.length > 0 && { sub: w.placeSub(facts.places) }),
        },
        ...(facts.products.length > 0
            ? [{ key: 'products' as const, label: w.stepProducts, state: understood ? 'done' as const : 'pending' as const, ...(understood && { chips: facts.products }) }]
            : []),
        { key: 'saved', label: w.stepSaved, state: journey?.writtenAt !== undefined ? 'done' : 'pending' },
    ];
    const firstPending = drafts.findIndex(d => d.state === 'pending');
    const steps: JourneyStep[] = drafts.map((d, i) => ({
        ...d,
        state: d.state === 'pending' ? (i === firstPending ? 'active' : 'waiting') : d.state,
    }));
    const counted = steps.filter(s => s.state !== 'skipped');
    const done = counted.filter(s => s.state === 'done').length;
    return { steps, progress: counted.length === 0 ? 0 : done / counted.length, complete: counted.length > 0 && done === counted.length };
}
