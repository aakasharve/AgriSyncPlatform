// spec: data-principle-spine-2026-05-05/06.4
//
// Frontend mirror of the ShramSafal domain `ConsentState` value object
// (Phase 06.1, OQ-1 verdict — entity lives at
// `src/apps/ShramSafal/ShramSafal.Domain/Privacy/UserConsentState.cs`).
//
// Three independent purposes per DPDP §6 + V2 Non-Negotiables 1+2:
//   - fullHistoryJournal:     retain voice clips beyond 30-day local window
//   - crossFarmAggregation:   de-identified usage to improve the app
//   - researchCorpusExport:   de-identified data shared with research partners
//
// All three default `false`. Opt-in per purpose. Revocation cascades on
// the backend; the client just reads/writes the boolean tuple. See
// `_COFOUNDER/.../06_[30]_CONSENT_DOMAIN.md` §6.4.1 for the canonical shape.

export interface ConsentState {
    fullHistoryJournal: boolean;
    crossFarmAggregation: boolean;
    researchCorpusExport: boolean;
    /**
     * Consent text version the user accepted. Bumped on every
     * counsel-approved edit to the agreement markdown files. Carried
     * on the audit row so a withdrawal can be tied to the exact copy
     * the user saw at consent time.
     */
    version: number;
    /** ISO-8601 UTC; null until first save. */
    acceptedAtUtc: string | null;
    /** ISO-8601 UTC; populated when ANY toggle goes true → false. */
    revokedAtUtc: string | null;
}

export const ConsentState = {
    default(): ConsentState {
        return {
            fullHistoryJournal: false,
            crossFarmAggregation: false,
            researchCorpusExport: false,
            version: 1,
            acceptedAtUtc: null,
            revokedAtUtc: null,
        };
    },
};
