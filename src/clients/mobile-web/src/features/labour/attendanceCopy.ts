/**
 * Labour V2 R1 — the founder-approved farmer-facing strings for the capture
 * flow, harvested verbatim from his 2026-09-02 master review
 * (docs/superpowers/mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md)
 * and the D1–D3-locked mockups. NO OTHER farmer-facing Marathi may be invented
 * on these surfaces; a missing string is a founder question, never a guess.
 * Numerals follow his convention: Latin digits (DM Sans) for quantities.
 */
export const ATTENDANCE_COPY = {
    /** State B — the reason under the inactive hero. Not a permission word anywhere. */
    noAnchorReason: 'आजच्या कामात किती जण होते ते अजून समजलं नाही. आधी आजचं काम सांगा.',
    understoodHeading: 'श्रम सफलला समजलं',
    /** D9.5 provenance chips. */
    youSaidChip: 'तुम्ही सांगितलं',
    explicitChip: 'स्पष्ट माहिती',
    /** Rung 2 — count known, nobody named (mockup 05, locked as drawn). */
    rungWho: (n: number) => `या ${n} जणांमध्ये कोण होते?`,
    /** Rung 3 — remainder (founder harvest, supersedes the mockup's unapproved line). */
    rungRemainder: 'यांच्याशिवाय अजून कोण होते?',
    /** Rung 4 — the only question left (founder harvest). */
    rungConfirm: 'हे बरोबर आहे का?',
    /** Pre-save honesty line (founder harvest). */
    preSaveHonesty: '"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.',
    confirmButton: 'बरोबर',
    editButton: 'बदल करा',
    /** State D — the contradiction question (founder harvest + mockup 04). */
    contradictionTitle: 'एक गोष्ट स्पष्ट करा',
    contradictionBody: (name: string, first: string, second: string) =>
        `${name} आज दोन कामांत दिसतोय — एकात ${first}, दुसऱ्यात ${second}. आजची हजेरी कोणती?`,
    contradictionReassurance: 'एकदाच स्पष्ट करा — दोन्ही कामांचं जे सांगितलं ते तसंच राहील.',
    /** Approved mark vocabulary — the only words the contradiction slots may hold. */
    markWord: { full: 'आला', half: 'अर्धा', night: 'रात्र' } as const,
} as const;
