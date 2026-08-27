// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// EVERYTHING THAT IS NOT CORE IS OFF UNTIL HE TURNS IT ON.
//
// Core consent (the one tap on the first-open gate) covers exactly six purposes and no
// more — `CORE_PURPOSE_CODES`. Every other use of a farmer's data is a separate decision
// with its own default of OFF, taken in `Settings → Data & Privacy` and withdrawable
// there just as easily.
//
// This module is the single place that answers "may we do X?" for the non-core purposes,
// so a feature cannot answer it for itself. `isOptionalPurposeGranted` returns false for
// anything it does not recognise, which means a NEW purpose is off by default without
// anybody remembering to switch it off — the one behaviour that survives a rushed feature.

import {
    OPTIONAL_PURPOSE_CODES,
    isCoveredByCoreConsent,
    type OptionalPurposeCode,
} from '../../../domain/consent/CoreConsentScope';
import { ConsentState } from '../../../domain/consent/ConsentState';

/**
 * What actually stops when a purpose is withdrawn — DPDP requires the consequence to be
 * explained, and an explanation is only true if it comes from the same table the feature
 * reads. Prose in a modal that nobody keeps in sync is how "we told you" becomes false.
 *
 * Keys are i18n-free deliberately: the screen renders `stops` through its own bundle.
 * What is fixed here is WHICH services stop, not the wording.
 */
export interface OptionalPurposeDefinition {
    code: OptionalPurposeCode;
    /** Server-backed toggle that carries this purpose today, if any. */
    consentStateField: keyof Pick<
        ConsentState, 'fullHistoryJournal' | 'crossFarmAggregation' | 'researchCorpusExport'
    > | null;
    /** Services that stop working when this is withdrawn. Empty = nothing stops. */
    stops: string[];
}

export const OPTIONAL_PURPOSES: readonly OptionalPurposeDefinition[] = [
    {
        code: 'VOICE_DIARY_ORIGINAL_AUDIO_RETENTION',
        consentStateField: 'fullHistoryJournal',
        // Withdrawing does NOT delete his work records — only the audio stops being kept.
        stops: ['voiceDiaryPlayback'],
    },
    {
        code: 'AI_MODEL_IMPROVEMENT',
        consentStateField: 'crossFarmAggregation',
        // Nothing he uses stops. Saying "nothing stops" is the honest answer and it is
        // also the one that makes the toggle a real choice rather than a hostage.
        stops: [],
    },
    {
        code: 'PROMOTIONAL_MESSAGES',
        // No server field yet — see the note on `isOptionalPurposeGranted`. Default OFF
        // is therefore not merely the default, it is the only reachable state.
        consentStateField: null,
        stops: [],
    },
    {
        code: 'PARTNER_SHARING_LENDING_INSURANCE_MARKETPLACE',
        consentStateField: 'researchCorpusExport',
        stops: [],
    },
];

/**
 * May we use the farmer's data for this purpose?
 *
 * FALSE unless (a) the purpose is a known optional one, (b) it has a control he can
 * actually see, and (c) that control is ON.
 *
 * A purpose with `consentStateField: null` has no control yet, so this returns false for
 * it ALWAYS — which is the correct and deliberate outcome: a purpose the farmer has no
 * way to grant is a purpose he has not granted. Building the feature first and the
 * control afterwards is how default-off silently becomes default-on.
 *
 * A CORE purpose passed here also returns false, loudly rather than helpfully: core
 * purposes are authorised by the gate, and a caller reaching for this function to check
 * one has asked the wrong question.
 */
export function isOptionalPurposeGranted(
    purpose: string,
    state: ConsentState | null | undefined,
): boolean {
    if (isCoveredByCoreConsent(purpose)) return false;

    const definition = OPTIONAL_PURPOSES.find((p) => p.code === purpose);
    if (!definition || !definition.consentStateField) return false;
    if (!state) return false;

    return state[definition.consentStateField] === true;
}

/** What stops if this purpose is withdrawn. Unknown purpose → nothing claimed. */
export function servicesThatStopWithout(purpose: string): readonly string[] {
    return OPTIONAL_PURPOSES.find((p) => p.code === purpose)?.stops ?? [];
}

/** Every optional purpose, whether or not it has a control yet. */
export const ALL_OPTIONAL_PURPOSE_CODES: readonly OptionalPurposeCode[] = OPTIONAL_PURPOSE_CODES;
