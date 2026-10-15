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
    youSaidChip: 'सांगितलेलं',
    /** The manual door: people the user marked on the list - marked, not spoken. */
    markedChip: 'निवडलेले',
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
    /*
     * ── NEW, PENDING FOUNDER APPROVAL (journey fixes D1/D6, 2026-10-11) ──
     * Each is assembled from approved words: `शेतनोंदीत गेली` (sync.* tails),
     * `कामगारांची जबाबदारी आहे` (D5, negated), `पुन्हा प्रयत्न करा` (labour
     * retry vocabulary), `काम झालं नाही` (the approved no-work door).
     */
    /** A mark the server refused: N of them did not reach the farm record. */
    refusedMarksTitle: (n: number) => `${n} हजेरी शेतनोंदीत जमा झाली नाही`,
    /** Shown ONLY when the server's own code says the caller may not take marks. */
    refusedMissingResponsibility: 'कामगारांची जबाबदारी तुमच्याकडे नाही.',
    refusedShowWhich: 'कोणत्या ते बघा',
    refusedRetry: 'पुन्हा प्रयत्न करा',
    /** The no-work declaration did not reach the farm record. */
    noWorkNotRecorded: '"काम झालं नाही" हा दिवस शेतनोंदीत जमा झाला नाही.',
    /*
     * ── TEMPORARY PLACEHOLDER - NEEDS FOUNDER WORDING (offline read-out, 2026-10-11) ──
     * No approved phrase for "this is the last copy we have / may be old" exists
     * in attendanceCopy, SYNC_HONESTY or the farmer vocabulary. Built only from
     * words already on this screen. The ONE place to change it.
     */
    staleReadoutNote: (ageLabel: string) => `ही माहिती जुनी असू शकते — ${ageLabel}`,
    staleAgeJustNow: 'थोड्या वेळापूर्वी मिळाली',
    staleAgeHours: (n: number) => `${n} तासांपूर्वी मिळाली`,
    staleAgeDays: (n: number) => `${n} दिवसांपूर्वी मिळाली`,
    /** Approved mark vocabulary — the only words the contradiction slots may hold. */
    markWord: { full: 'आला', half: 'अर्धा', night: 'रात्र' } as const,
} as const;
