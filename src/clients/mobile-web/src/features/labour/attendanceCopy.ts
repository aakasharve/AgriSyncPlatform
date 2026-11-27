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
    /**
     * Founder D-46 (2026-10-27) — his own words for a record saved but not yet confirmed
     * ("नोंदी जतन झाल्या · खात्री बाकी"): the chip on a headcount the mic opened on before the
     * owner confirmed it. Provisional context, never shown as confirmed.
     */
    provisionalChip: 'खात्री बाकी',
    /** Rung 2 — count known, nobody named (mockup 05, locked as drawn). */
    rungWho: (n: number) => `या ${n} जणांमध्ये कोण होते?`,
    /** Rung 3 — remainder (founder harvest, supersedes the mockup's unapproved line). */
    rungRemainder: 'यांच्याशिवाय अजून कोण होते?',
    /** Rung 4 — the only question left (founder harvest). */
    rungConfirm: 'हे बरोबर आहे का?',
    /** Pre-save honesty line (founder harvest). */
    preSaveHonesty: '"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.',
    confirmButton: 'बरोबर',
    /** spec: plr-d10 (WP-1 A9) — above the day chips (आज · काल · २३ ऑक्टो). PROPOSED copy, founder sign-off at A5. */
    dayChoiceQuestion: 'कोणत्या दिवसाची हजेरी?',
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
    /** PLR-D10 L3a (D-16) — shown ONLY when the server's own code says the day has not happened yet. PROPOSED (Marathi). */
    refusedFutureDate: 'पुढच्या दिवसाची हजेरी घेता येत नाही.',
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

/**
 * Repair FIX-1 round 1 (Bug 5) — the words of the हजेरी CONFIRM CARD (AttendanceResult and the HeadcountDisagreementCard
 * it draws), one language at a time. Marathi is `ATTENDANCE_COPY` exactly (the founder's words, never changed here) plus
 * the card's few inline words, unchanged; English is its twin, every line PROPOSED (English).
 */
export interface AttendanceCardCopy {
    understoodHeading: string;
    youSaidChip: string;
    markedChip: string;
    explicitChip: string;
    provisionalChip: string;
    rungWho: (n: number) => string;
    rungRemainder: string;
    rungConfirm: string;
    preSaveHonesty: string;
    confirmButton: string;
    editButton: string;
    contradictionTitle: string;
    contradictionBody: (name: string, first: string, second: string) => string;
    contradictionReassurance: string;
    markWord: { full: string; half: string; night: string };
    /** After the head count: "8 जण". */
    people: string;
    /** The mic button under a question. */
    speak: string;
    /** The disagreement card: what was understood before, then that both stay. */
    understoodBefore: (n: number) => string;
    bothStay: string;
}

const ATTENDANCE_CARD_MR: AttendanceCardCopy = {
    ...ATTENDANCE_COPY,
    people: 'जण',
    speak: 'बोला',
    understoodBefore: n => `आजच्या कामात ${n} जण होते, असं आधी समजलं होतं.`,
    bothStay: 'दोन्ही गोष्टी तशाच राहतील.',
};

/** PROPOSED (English) — the card's English twin. */
export const ATTENDANCE_COPY_EN: AttendanceCardCopy = {
    understoodHeading: 'ShramSafal understood',
    youSaidChip: 'You said',
    markedChip: 'Marked',
    explicitChip: 'Clearly stated',
    provisionalChip: 'Not yet confirmed',
    rungWho: n => `Who were these ${n} people?`,
    rungRemainder: 'Who else was there?',
    rungConfirm: 'Is this right?',
    preSaveHonesty: 'Nothing is saved until you press "Correct".',
    confirmButton: 'Correct',
    editButton: 'Change',
    contradictionTitle: 'Make one thing clear',
    contradictionBody: (name, first, second) => `${name} shows in two works today — ${first} in one, ${second} in the other. Which is today's attendance?`,
    contradictionReassurance: 'Answer once — what was said for both works stays as it was.',
    markWord: { full: 'Present', half: 'Half', night: 'Night' },
    people: 'people',
    speak: 'Speak',
    understoodBefore: n => `Earlier it was understood that ${n} people were in today's work.`,
    bothStay: 'Both stay as they are.',
};

/** English only for 'en'; every other language reads the Marathi (as `authorityCopy` does). */
export function attendanceCardCopy(language: string | null | undefined): AttendanceCardCopy {
    return language === 'en' ? ATTENDANCE_COPY_EN : ATTENDANCE_CARD_MR;
}

/**
 * Repair FIX-1 item 6 (R2-B 19-B, founder 27 Nov) — where each spoken name stands on the confirm card, said BEFORE "बरोबर".
 * The six Marathi state words are the founder's own; the add form's words are the existing add's (AttendanceRoster /
 * FieldOperatorPicker). English twins follow `TAP_WORDS` in AttendanceResult. The count uses Latin digits like the card's head count; one name is singular.
 */
export const NAME_STATE_COPY = {
    mr: {
        onList: 'यादीत आहे',
        notOnList: 'यादीत नाही',
        pickFromList: 'यादीतून निवडा',
        addNew: 'नवीन नाव जोडा',
        sharedWho: 'सारखं नाव — कोण?',
        // Latin digits, like the head count on the same card (this file's rule above); one name is singular ("नावाची").
        unmarkedLine: (n: number) => `${n} ${n === 1 ? 'नावाची' : 'नावांची'} हजेरी लागली नाही`,
        sameNameNote: 'सारखं नाव — माणूस वेगळा',
        namePlaceholder: 'नाव',
        fullNamePlaceholder: 'पूर्ण नाव किंवा ओळख — हवं तर',
        add: 'जोडा',
        addFailed: 'नाव जोडता आलं नाही — पुन्हा प्रयत्न करा',
        close: 'बंद करा',
    },
    en: {
        onList: 'On the list',
        notOnList: 'Not on the list',
        pickFromList: 'Choose from the list',
        addNew: 'Add a new name',
        sharedWho: 'Same name — who?',
        unmarkedLine: (n: number) => `Attendance not marked for ${n} ${n === 1 ? 'name' : 'names'}`,
        sameNameNote: 'Same name — a different person',
        namePlaceholder: 'Name',
        fullNamePlaceholder: 'Full name or identity — optional',
        add: 'Add',
        addFailed: 'Could not add the name — try again',
        close: 'Close',
    },
} as const;

/**
 * Repair FIX-1 item 8 (R2-B 19-E step 1, founder 27 Nov) — "कोणामार्फत?" on a new entry's labour line. The three Marathi
 * answers are the founder's words; "कोणामार्फत: ‹नाव›" (the answer shown back) and the count prefix are new (PROPOSED).
 */
export const THROUGH_COPY = {
    mr: {
        ask: 'कोणामार्फत?',
        nobody: 'कोणी नाही',
        notKnown: 'माहीत नाही',
        chosen: (answer: string) => `कोणामार्फत: ${answer}`,
        crew: (n: number) => `${n} जण`,
    },
    en: {
        ask: 'Through whom?',
        nobody: 'Nobody',
        notKnown: 'Not known',
        chosen: (answer: string) => `Through: ${answer}`,
        crew: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
    },
} as const;
