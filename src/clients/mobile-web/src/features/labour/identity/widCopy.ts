/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. Every farmer-facing word of the worker-identity screens,
 * in Marathi and English twins (one language at a time: Marathi mode shows Marathi only). Words the founder approved on
 * the D-54 screens are marked SCREEN (verbatim from G:\VALIDATION\PRODUCT CHANGES\D54-D55-worker-identity); everything
 * else is PROPOSED, awaiting the founder. The level and whose-phone words live in the one names helper
 * (shared/names/namesIn: identityLevelIn, phoneWhoseIn).
 */

type Lang = string | null | undefined;
type Twin = readonly [mr: string, en: string];

const T = {
    // ── add a worker (screen 1) ──
    addTitle: ['कामगार जोडा', 'Add a worker'], // SCREEN
    name: ['नाव', 'Name'], // SCREEN
    identify: ['ओळखण्यासाठी (गाव / वडिलांचं नाव / टोपणनाव)', 'To tell him apart (village / father\'s name / nickname)'], // SCREEN
    identifyHint: ['एकाच नावाचे दोन बाळू असतील तर ओळखता यावे म्हणून.', 'So two people with the same name can be told apart.'], // SCREEN
    pinLabel: ['राहतो त्या गावाचा पिन कोड', 'PIN code where he lives'], // SCREEN
    farmPinChip: ['शेताचाच पिन', 'Farm\'s own PIN'], // SCREEN
    otherPin: ['दुसरा पिन', 'Another PIN'], // SCREEN
    pinNote: ['पूर्ण पत्ता नको — फक्त 6 अंकी पिन.', 'No full address — only the 6-digit PIN.'], // SCREEN
    pinHint: ['पिन 6 अंकी असतो', 'A PIN has 6 digits'], // SCREEN (section 9)
    farmPinToo: ['हाच शेताचाही पिन आहे', 'This is the farm\'s PIN too'], // PROPOSED
    phoneLabel: ['फोन नंबर', 'Phone number'], // SCREEN
    phoneNote: ['स्वतःचा फोन नसेल तर घरच्या माणसाचा किंवा मुकादमचा नंबर द्या.', 'No phone of his own? Give a family member\'s or the mukadam\'s number.'], // SCREEN
    phonePlaceholder: ['10 अंकी नंबर', '10-digit number'], // PROPOSED (fix pass 1, L6: no Latin "x")
    pinPlaceholder: ['6 अंकी पिन', '6-digit PIN'], // PROPOSED (fix pass 1, L6: never a real PIN)
    whose: ['हा फोन कोणाचा?', 'Whose phone is this?'], // SCREEN
    add: ['जोडा', 'Add'], // SCREEN
    requiredNote: ['नाव, पिन कोड आणि फोन नंबर — तिन्ही भरल्याशिवाय "जोडा" चालू होत नाही. आजचं काम मात्र कधीच अडत नाही.', 'Name, PIN code and phone number — "Add" turns on once all three are filled. Today\'s work is never held up.'], // SCREEN
    cardAuto: ['"जोडा" दाबताच त्याला कायमचा श्रमसफल ओळख क्रमांक आणि QR कार्ड आपोआप मिळतं.', 'The moment you tap Add, he gets a permanent ShramSafal ID and QR card.'], // SCREEN
    byCard: ['कोड किंवा QR ने जोडा', 'Add by code or QR'], // brief (orchestrator call 4)
    sharedQuestion: ['हा नंबर आधीच {names} साठी आहे', 'This number is already given for {names}'], // SCREEN (screen 4)
    sharedAsk: ['एकाच घरचा फोन आहे का?', 'Is it one family phone?'], // SCREEN
    sharedYes: ['हो, घरचा फोन', 'Yes, family phone'], // SCREEN
    sharedChange: ['नंबर बदला', 'Change the number'], // SCREEN
    verifiedElsewhere: ['हा नंबर एका पडताळलेल्या ओळखीशी जोडलेला आहे — QR स्कॅन करा किंवा त्याला आलेला कोड टाका', 'This number belongs to a verified identity — scan his QR or enter the code he received'], // design case 11
    later: ['नंतर करा', 'Later'], // design section 9
    close: ['बंद करा', 'Close'],

    // ── the card (screen 2) ──
    cardTitle: ['ओळखपत्र', 'ID card'], // SCREEN
    cardBrand: ['श्रमसफल · कामगार ओळखपत्र', 'ShramSafal · worker ID card'], // SCREEN
    levelNameDone: ['नाव झालं', 'Name done'], // SCREEN
    levelCardDone: ['कार्ड झालं', 'Card done'], // SCREEN
    levelPhoneDone: ['फोन पडताळलेला', 'Phone verified'], // SCREEN
    done: ['झालं', 'done'], // SCREEN
    pending: ['बाकी', 'pending'], // SCREEN
    shareWhatsApp: ['WhatsApp वर पाठवा', 'Send on WhatsApp'], // SCREEN
    print: ['छापा', 'Print'], // SCREEN
    verifyPhone: ['फोन पडताळा', 'Verify phone'], // SCREEN
    newCard: ['नवीन कार्ड द्या', 'Issue a new card'], // PROPOSED (case 13)
    newCardAsk: ['जुनं कार्ड चालणार नाही. नवीन कार्ड द्यायचं?', 'The old card will stop working. Issue a new one?'], // PROPOSED
    newCardDone: ['नवीन कार्ड तयार. जुनं कार्ड आता चालत नाही.', 'New card ready. The old card no longer works.'], // PROPOSED
    newCardOwnerOnly: ['नवीन कार्ड फक्त शेताचे मालकच देऊ शकतात.', 'Only the farm\'s owner can issue a new card.'], // PROPOSED (fix pass 1, L6)
    newCardNotHere: ['ज्या शेतावर याचं कार्ड बनलं किंवा फोन पडताळला, तेच शेत नवीन कार्ड देऊ शकतं.', 'Only the farm that made his card or verified his phone can issue a new card.'], // PROPOSED (fix pass 1, H1)
    useMove: ['याचा एक नंबर आधीच पडताळलेला आहे — दुसरा नंबर पडताळता येत नाही.', 'He already has a verified number — a second one cannot be verified.'], // PROPOSED (fix pass 1, H2)
    erased: ['या कामगाराची ओळख मिटवली आहे.', 'This worker\'s identity has been erased.'], // PROPOSED (fix pass 1, L6)
    shareFailed: ['चित्र पाठवता आलं नाही — QR स्क्रीनवर दाखवा', 'Could not send the picture — show the QR on screen'], // PROPOSED
    linkCopied: ['कार्डचा पत्ता कॉपी केला', 'Card address copied'], // PROPOSED

    // ── verify the phone (screen 3) ──
    codeSent: ['{name}च्या फोनवर (…{tail}) 4 अंकी कोड पाठवला आहे.', 'A 4-digit code was sent to {name}\'s phone (…{tail}).'], // SCREEN
    codeAsk: ['{name}ला विचारा आणि तो कोड इथे टाका.', 'Ask {name} and enter the code here.'], // SCREEN (shortened)
    verify: ['पडताळा', 'Verify'], // SCREEN
    verifiedNote: ['फोन पडताळला. हा नंबर आता फक्त {name}चा.', 'Phone verified. This number is now only {name}\'s.'], // SCREEN
    codeWrong: ['हा कोड जुळला नाही — पुन्हा पहा', 'That code did not match — check again'], // PROPOSED
    codeExpired: ['कोडची वेळ संपली — नवीन कोड पाठवा', 'The code expired — send a new one'], // PROPOSED
    smsOff: ['कोड पाठवणं अजून सुरू झालेलं नाही — नंतर करा', 'Sending codes has not started yet — later'], // PROPOSED (DLT pending)
    noPhone: ['आधी फोन नंबर भरा', 'Enter a phone number first'], // PROPOSED
    tooMany: ['आज खूप कोड पाठवले — थोड्या वेळाने', 'Too many codes today — try a little later'], // PROPOSED
    tooManyTries: ['आज खूप चुकीचे कोड टाकले गेले — उद्या पुन्हा करा.', 'Too many wrong codes today — try again tomorrow.'], // PROPOSED (fix pass 1, M2)

    // ── link on another farm (screen 5) ──
    linkTitle: ['आधीच श्रमसफलवर आहे?', 'Already on ShramSafal?'], // SCREEN
    linkHint: ['त्याचं ओळखपत्र स्कॅन करा, किंवा कोड टाका.', 'Scan his ID card, or type its code.'], // SCREEN (shortened)
    holdQr: ['QR इथे धरा', 'Hold the QR here'], // SCREEN
    typeCode: ['कार्डवरचा कोड टाका', 'Type the code on the card'], // PROPOSED
    typedNotCode: ['हा कार्डचा कोड वाटत नाही — SS-XXXX-XXXX असा असतो', 'That does not look like a card code — it reads SS-XXXX-XXXX'], // PROPOSED
    find: ['शोधा', 'Find'], // PROPOSED
    cameraOff: ['कॅमेरा चालू झाला नाही — कोड टाका', 'The camera did not start — type the code'], // PROPOSED
    linkCodeSent: ['{name}च्या फोनवर कोड पाठवला — त्याची परवानगी लागेल.', 'A code was sent to {name}\'s phone — his consent is needed.'], // SCREEN
    linkCodeSentToNumber: ['या नंबरवर कोड पाठवला — त्याची परवानगी लागेल.', 'A code was sent to this number — his consent is needed.'], // PROPOSED (fix pass 1, L6: the number path names nobody)
    sameMan: ['तोच माणूस — जोडा', 'Same person — add'], // SCREEN
    otherFarmsHidden: ['तुम्हाला त्याचं दुसऱ्या शेतावरचं काम किंवा पगार दिसणार नाही.', 'You will not see his work or pay on any other farm.'], // PROPOSED (screen 5 sentence, generalised)
    cardRetired: ['हे कार्ड आता चालत नाही', 'This card no longer works'], // design case 13
    cardUnknown: ['या कोडचं कार्ड सापडलं नाही', 'No card has this code'], // PROPOSED
    numberUnknown: ['हा नंबर सापडला नाही', 'Number not found'], // PROPOSED (fix pass 1, L6)
    alreadyOnTeam: ['हा माणूस आधीच तुमच्या टीममध्ये आहे', 'This person is already on your team'], // PROPOSED

    // ── the name-only list (section 10) ──
    completeTitle: ['यांचा फोन व पिन भरा', 'Add their phone and PIN'], // section 10 (founder correction)
    completeBadge: ['पूर्ण करा — फोन व पिन', 'Complete — phone and PIN'], // SCREEN (screen 7)
    save: ['ठेवा', 'Save'], // PROPOSED

    // ── failures (reused shape of the team page) ──
    offline: ['इंटरनेट नसल्यामुळे आत्ता करता आलं नाही — नेट आल्यावर पुन्हा करा.', 'No internet right now — try again when online.'],
    failed: ['झालं नाही — पुन्हा प्रयत्न करा', 'That did not work — try again'],
} as const satisfies Record<string, Twin>;

export type WidWord = keyof typeof T;

/** One word in this language (Marathi unless English is chosen), with {name}-style blanks filled. */
export function widText(key: WidWord, language: Lang, fill: Record<string, string> = {}): string {
    const [mr, en] = T[key];
    const text = language === 'en' && en ? en : mr;
    return text.replace(/\{(\w+)\}/g, (_, k: string) => fill[k] ?? '');
}
