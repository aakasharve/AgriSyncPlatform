/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — every farmer-facing word of the team screen
 * ("माझी टीम") in one place, so a founder change of wording is one edit.
 *
 * Where each string comes from:
 *  - FOUNDER / LANE BRIEF words, verbatim: "आत येऊ इच्छितात", "काम सांगणे", "काम + हजेरी",
 *    "नको", "आणखी", "मंजुरीची वाट", "काम थांबवलं — कारण…", "माझी टीम".
 *  - PREVIEW words ported from the approved PLR-D7 preview (plr-d1a `multiuser/muModel.ts` MS /
 *    PERM_SHORT, `app/HubPages.tsx`): "शेताचा कोड", "हा कोड कायम राहतो…", "काय करू देणार?",
 *    "काम थांबवा", "पुन्हा सुरू करा", "शेतातून काढा", "काम थांबवलं आहे. जुनी माहिती तशीच आहे.",
 *    the short do-words, "मंजूर", "बदला".
 *  - Everything marked `// PROPOSED (Marathi)` is new wording written for this screen: proposed,
 *    awaiting the founder.
 *
 * Founder D-22 (26 Oct): the कुटुंब choice and its money switch are NOT offered in step 2 (a family
 * / co-owner choice with visible switches is proposed for step 2b), so their words are gone too.
 */

export const TEAM_COPY = {
    pageTitle: 'माझी टीम',
    // Hub row line for the owner (preview HubPages: "कोण, कोणती भूमिका · नवीन व्यक्ती जोडा").
    hubLine: 'कोण, कोणती भूमिका · नवीन व्यक्ती जोडा',
    // Hub row line for a मुकादम, who only views (preview HubPages: "माझ्या टोळीतले लोक").
    crewLine: 'माझ्या टोळीतले लोक',
    // Preview HubPages (non-owner team page): "नवीन व्यक्ती फक्त मालक जोडू शकतो."
    ownerAddsOnly: 'नवीन व्यक्ती फक्त मालक जोडू शकतो.',
    code: 'शेताचा कोड',
    codeStays: 'हा कोड कायम राहतो. QR बदलला तरी कोड तोच.',
    showQr: 'शेताचा QR दाखवा', // PROPOSED (Marathi)
    noCodeYet: 'कोड अजून आला नाही — QR उघडल्यावर तयार होईल.', // PROPOSED (Marathi)

    requestsTitle: (n: number) => (n === 1 ? '1 व्यक्ती आत येऊ इच्छिते' : `${n} जण आत येऊ इच्छितात`), // PROPOSED (Marathi) — count form of "आत येऊ इच्छितात"
    wantsIn: (name: string) => `${name} आत येऊ इच्छितात`,
    viaCode: 'शेताचा कोड टाकून विचारलं', // PROPOSED (Marathi)
    viaQr: 'QR स्कॅन करून विचारलं', // PROPOSED (Marathi)
    // M-7: names are self-typed — the last four digits of the account's phone.
    phoneTail: (last4: string) => `मोबाईल …${last4}`, // PROPOSED (Marathi)
    quick: 'काय करू देणार?',
    approve: 'मंजूर',
    decline: 'नको',

    presetWork: 'काम सांगणे',
    presetCrew: 'काम + हजेरी',
    presetWorkHint: 'आपलं झालेलं काम सांगतील', // PROPOSED (Marathi)
    presetCrewHint: 'काम सांगतील, हजेरी व पक्कं करतील', // PROPOSED (Marathi)

    peopleTitle: 'शेतातली माणसं', // PROPOSED (Marathi)
    // M-8 (a): one honest line until the role-scoped download (step 4a) narrows what each phone gets.
    allRecordsNote: 'सध्या शेतातल्या प्रत्येकाच्या फोनवर सर्व नोंदी, पैसेसुद्धा, जातात — पुढच्या टप्प्यात हे बंद होईल.', // PROPOSED (Marathi)
    // M-8 (b): how a person came in, from the server's facts.
    cameByQrDirect: 'QR ने थेट आले', // PROPOSED (Marathi)
    cameByCodeApproved: 'कोड टाकून विचारलं · मालकाने मंजूर केलं', // PROPOSED (Marathi)
    cameByQrApproved: 'QR स्कॅन करून विचारलं · मालकाने मंजूर केलं', // PROPOSED (Marathi)
    noPeople: 'अजून कोणी जोडलेलं नाही. शेताचा QR किंवा कोड द्या.', // PROPOSED (Marathi)
    change: 'बदला',
    close: 'बंद करा',
    more: 'आणखी',
    pause: 'काम थांबवा',
    resume: 'पुन्हा सुरू करा',
    remove: 'शेतातून काढा',
    pausedNote: 'काम थांबवलं आहे. जुनी माहिती तशीच आहे.',
    reasonLine: (reason: string) => `कारण: ${reason}`, // PROPOSED (Marathi)
    you: 'तुम्ही', // preview MS.roleBarFor
    registrantNote: 'शेत यांच्या नावावर आहे', // PROPOSED (Marathi)

    // The reason step (decline / pause / remove).
    reasonLabel: 'कारण (हवं तर लिहा)', // PROPOSED (Marathi)
    reasonSeen: 'हे कारण त्या व्यक्तीला दिसेल.', // PROPOSED (Marathi)
    reasonTooLong: (max: number) => `कारण ${max} अक्षरांपेक्षा मोठं आहे — थोडं कमी करा.`, // PROPOSED (Marathi)
    cancel: 'रद्द',
    declineAsk: 'ही विनंती नाकारायची?', // PROPOSED (Marathi)
    pauseAsk: 'या व्यक्तीचं काम थांबवायचं?', // PROPOSED (Marathi)
    removeAsk: 'खरंच शेतातून काढायचं? जुनी माहिती तशीच राहील.', // PROPOSED (Marathi)

    // Failures, said plainly — never "done" when it was not.
    lastOwner: 'शेतात एक तरी मालक राहिला पाहिजे — हे करता येत नाही.', // PROPOSED (Marathi)
    wrongStatus: 'या व्यक्तीची स्थिती आधीच बदलली आहे — यादी पुन्हा आणली.', // PROPOSED (Marathi)
    forbidden: 'हे तुम्हाला करता येत नाही.',
    failed: 'हा बदल करता आला नाही. पुन्हा प्रयत्न करा.',
    loadFailed: 'टीमची यादी आत्ता आणता आली नाही. पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
    retry: 'पुन्हा आणा', // PROPOSED (Marathi)
    nameUnknown: '—',
} as const;

/** The short "what they may do" words (preview PERM_SHORT). */
export const DO_WORDS = {
    tellWork: 'काम सांगणे',
    attendance: 'हजेरी',
    verify: 'पक्कं करणे',
    addCost: 'खर्च नोंदवणे',
    invite: 'माणसं बोलावणे',
} as const;
