// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// THE NOTICE. Everything the farmer is shown on the first-open consent gate lives in
// this one module, in both languages, as data.
//
// Why one module and not `translations.ts`: wave-4.2 has to store a cryptographic hash
// of the EXACT notice that was displayed, so that years later a stored consent can be
// tied to the words that earned it. A hash is only worth something if the thing hashed
// is the thing rendered — which means the notice must be a single addressable document
// with a single canonical serialisation (`canonicalNoticeText` below), not a scattering
// of translation keys that a later edit can drift away from. `translations.ts` carries
// the screen CHROME only (the language switcher, the expand affordance); nothing in the
// chrome makes a legal statement.
//
// ── LEGAL_REVIEW_PENDING ────────────────────────────────────────────────────────────
// Per DS-015 / the LEGAL_REVIEW_PENDING convention, this copy is ENGINEERING-AUTHORED
// and has not been through counsel. The marker is carried once, here, as
// `NOTICE_LEGAL_REVIEW_PENDING` rather than as a `[LEGAL_REVIEW_PENDING] ` prefix on
// every string: prefixing would put the tag in front of every line a farmer reads, and
// a notice that is hard to read is a worse consent notice, not a safer one. The CI gate
// (.github/workflows/legal-review-gate.yml) greps for the token, so the prod-deploy
// block still fires while this constant exists.
//
// 🛑 SIX FIELDS THE FOUNDER STILL OWES (his own list, master plan §W4). They are
// rendered ON SCREEN as visible, unfilled placeholders rather than quietly omitted —
// see `pendingDisclosures`. Until they land, NO wording here or anywhere else may claim
// DPDP compliance.
//
// Founder decision 13 scopes the word for "record" (n-o-n-d) to Sathi's own surface. It
// appears nowhere in the copy below — deliberately spelled out here rather than written,
// so a grep for the word over this file returns nothing.

import {
    CORE_DATA_CATEGORY_CODES,
    CORE_PURPOSE_CODES,
    type CoreDataCategoryCode,
    type CorePurposeCode,
} from '../../../domain/consent/CoreConsentScope';

/** The CI gate greps for this token; see the header note. */
export const NOTICE_LEGAL_REVIEW_PENDING = 'LEGAL_REVIEW_PENDING' as const;

/**
 * Versions carried onto BOTH legal records. Bump the notice version on any change to
 * the text below; bump the policy/terms versions when those documents change. They are
 * separate on purpose — the notice can be reworded without the Terms changing, and a
 * record has to be able to say which of the three moved.
 */
export const NOTICE_VERSION = 'notice-2026-08-16.1';
export const PRIVACY_POLICY_VERSION = 'privacy-2026-08-16.1';
export const TERMS_VERSION = 'terms-2026-08-16.1';

export type NoticeLanguage = 'mr' | 'en';

/** One expandable data-purpose card. */
export interface PurposeCard {
    /** Stable id — used for test targeting and for the expand/collapse state. */
    id: 'account' | 'farmWork' | 'voiceUploads' | 'farmLocation' | 'technical';
    title: string;
    /** One line, always visible — the card must be understandable unexpanded. */
    summary: string;
    /** What we actually take. Visible when expanded. */
    collects: string[];
    /** Why we need it, in the farmer's terms. Visible when expanded. */
    why: string;
    /** Codes this card maps onto in the stored record. Never shown to the farmer. */
    purposes: CorePurposeCode[];
    dataCategories: CoreDataCategoryCode[];
}

export interface NoticeCopy {
    title: string;
    intro: string;
    purposeCardsHeading: string;
    cards: PurposeCard[];
    willNotDo: { heading: string; items: string[] };
    rights: { heading: string; items: string[]; where: string };
    /** What the single tap actually does. Disclosed, because one button writing two
     *  records is only honest if the farmer is told that is what it does. */
    acceptanceMeaning: string;
    ageDeclaration: string;
    cta: string;
    ctaDisabledHint: string;
    pendingDisclosures: { heading: string; note: string; items: string[] };
    links: { terms: string; privacy: string };
}

// ── मराठी ───────────────────────────────────────────────────────────────────────────
const mr: NoticeCopy = {
    title: 'आम्ही तुमची माहिती कशी वापरतो',
    intro: 'श्रम सफल वापरायला सुरुवात करण्यापूर्वी हे एकदा वाचा. तुम्ही काय द्याल, ते आम्ही कशासाठी वापरू, आणि काय कधीच करणार नाही — सगळं इथे लिहिलं आहे.',
    purposeCardsHeading: 'कोणती माहिती, कशासाठी',
    cards: [
        {
            id: 'account',
            title: 'तुमचं खातं',
            summary: 'तुम्हीच आहात हे ओळखण्यासाठी.',
            collects: [
                'तुमचा मोबाईल नंबर आणि तुमचं नाव',
                'तुम्ही कधी लॉग-इन केलं याची माहिती',
            ],
            why: 'यामुळेच तुमचं शेत आणि तुमचं काम फक्त तुम्हालाच दिसतं, दुसऱ्या कुणालाही नाही.',
            purposes: ['ACCOUNT_AUTHENTICATION', 'SECURITY'],
            dataCategories: ['IDENTITY_AND_CONTACT'],
        },
        {
            id: 'farmWork',
            title: 'शेतातलं काम',
            summary: 'तुम्ही सांगितलेलं काम जपून ठेवण्यासाठी.',
            collects: [
                'तुम्ही सांगितलेली कामं, खर्च, मजूर, पाणी आणि फवारणी',
                'तुमचे प्लॉट आणि पिकं',
                'काम कोणत्या दिवशी झालं',
            ],
            why: 'हाच तुमच्या शेताचा हिशोब आहे आणि तो तुमचा आहे. तो तुम्हाला केव्हाही पाहता येतो, दुरुस्त करता येतो आणि पुसून टाकायला सांगता येतो.',
            purposes: ['FARM_OPERATIONS', 'OFFLINE_SYNC'],
            dataCategories: ['FARM_WORK_RECORDS'],
        },
        {
            id: 'voiceUploads',
            title: 'आवाज आणि फोटो',
            summary: 'तुम्ही बोललेलं समजून घेण्यासाठी.',
            collects: [
                'तुम्ही बोललेला आवाज',
                'त्या आवाजाचं मजकुरात केलेलं रूपांतर',
                'तुम्ही पाठवलेले फोटो आणि पावत्या',
            ],
            why: 'आवाजाचं मजकुरात रूपांतर करण्यासाठी तो आमच्या भागीदार सेवेकडे जातो. एवढ्यापुरतंच. मूळ आवाज पुढे साठवून ठेवायचा की नाही हे तुम्ही वेगळं ठरवता — ती परवानगी सुरुवातीला बंदच असते, आणि तुम्ही ती दिल्याशिवाय आम्ही आवाज साठवत नाही.',
            purposes: ['VOICE_PROCESSING_FOR_WORK_RECORD'],
            dataCategories: ['VOICE_AUDIO_AND_TRANSCRIPT'],
        },
        {
            id: 'farmLocation',
            title: 'शेताचं ठिकाण',
            summary: 'तुमच्या शेतापुरता हवामान अंदाज देण्यासाठी.',
            collects: [
                'तुम्ही नकाशावर आखलेली शेताची हद्द',
                'तुम्ही परवानगी दिली तरच — फोनचं सध्याचं ठिकाण',
            ],
            why: 'ठिकाण माहीत नसेल तर तुमच्या शेतापुरतं हवामान सांगता येत नाही. ठिकाण न देताही बाकीचं सगळं अ‍ॅप चालतं.',
            purposes: ['PLOT_SPECIFIC_WEATHER'],
            dataCategories: ['FARM_LOCATION'],
        },
        {
            id: 'technical',
            title: 'तांत्रिक माहिती',
            summary: 'अ‍ॅप चालू आणि सुरक्षित ठेवण्यासाठी.',
            collects: [
                'फोनचा प्रकार आणि अ‍ॅपची आवृत्ती',
                'अ‍ॅप बंद पडलं तर त्याची चूक-माहिती',
                'इंटरनेट नसताना फोनमध्ये ठेवलेली आणि नंतर पाठवलेली माहिती',
            ],
            why: 'यात तुमचं नाव नसतं आणि तुमचं काम नसतं. अ‍ॅप कुठे अडतं एवढंच कळतं.',
            purposes: ['SECURITY', 'OFFLINE_SYNC'],
            dataCategories: ['DEVICE_TECHNICAL'],
        },
    ],
    willNotDo: {
        heading: 'आम्ही काय करणार नाही',
        items: [
            'तुमची माहिती विकणार नाही.',
            'तुमच्या वेगळ्या परवानगीशिवाय बँक, विमा कंपनी, व्यापारी किंवा कोणत्याही भागीदाराला देणार नाही.',
            'तुम्ही परवानगी दिल्याशिवाय तुमचा आवाज साठवून ठेवणार नाही.',
            'तुमचं काम जाहिरातीसाठी वापरणार नाही.',
            'मायक्रोफोनला तुम्ही नाही म्हटलं म्हणून अ‍ॅप बंद करणार नाही — हाताने लिहून सगळं करता येतं.',
            'वर लिहिलेल्या कामांशिवाय दुसऱ्या कशासाठीही ही माहिती वापरणार नाही. नवीन कारण आलं तर आम्ही पुन्हा विचारू.',
        ],
    },
    rights: {
        heading: 'तुमचे हक्क',
        items: [
            'तुमची माहिती तुम्हाला पाहता येते.',
            'चुकीचं असेल ते दुरुस्त करता येतं.',
            'माहिती पुसून टाकायला सांगता येतं.',
            'दिलेली परवानगी केव्हाही मागे घेता येते — देण्याइतकीच सोपी. कोणती सेवा थांबेल ते आम्ही तेव्हा स्पष्ट सांगू.',
            'तक्रार असेल तर ती आमच्याकडे करता येते आणि नंतर माहिती संरक्षण मंडळाकडेही करता येते.',
        ],
        where: 'हे सगळं ‘सेटिंग्ज → माहिती आणि गोपनीयता’ इथे आहे.',
    },
    acceptanceMeaning: 'हे एक बटण दाबल्यावर दोन वेगळ्या गोष्टी होतात: तुम्ही वापराच्या अटी स्वीकारता, आणि वर लिहिलेल्या कामांपुरती — तेवढ्यापुरतीच — माहिती वापरायला परवानगी देता. दोन्ही वेगवेगळ्या साठवल्या जातात आणि दोन्ही तुम्ही वेगवेगळ्या मागे घेऊ शकता.',
    ageDeclaration: 'माझं वय १८ वर्षे किंवा त्याहून जास्त आहे.',
    cta: 'मी वाचलं, मी सहमत आहे',
    ctaDisabledHint: 'पुढे जाण्यासाठी वरची खूण करा.',
    pendingDisclosures: {
        heading: 'हे अजून भरायचं आहे',
        note: 'ही चाचणी आवृत्ती आहे. खालच्या गोष्टी अजून ठरायच्या आहेत आणि त्या ठरल्यावर आम्ही तुम्हाला पुन्हा दाखवू.',
        items: [
            'कंपनीचं कायदेशीर नाव — [अद्याप भरलेलं नाही]',
            'कार्यालयाचा पत्ता — [अद्याप भरलेलं नाही]',
            'गोपनीयता आणि तक्रार अधिकाऱ्याचा संपर्क — [अद्याप भरलेलं नाही]',
            'माहिती हाताळणाऱ्या भागीदार सेवा आणि त्यांची ठिकाणं — [अद्याप भरलेलं नाही]',
            'कोणती माहिती किती काळ ठेवली जाईल — [अद्याप भरलेलं नाही]',
            '१८ वर्षांखालील वापरकर्त्यांबाबतचं धोरण — [अद्याप भरलेलं नाही]',
        ],
    },
    links: { terms: 'वापराच्या अटी', privacy: 'गोपनीयता धोरण' },
};

// ── English ─────────────────────────────────────────────────────────────────────────
const en: NoticeCopy = {
    title: 'How we use your information',
    intro: 'Please read this once before you start using Shram Safal. What you give us, what we use it for, and what we will never do — all of it is here.',
    purposeCardsHeading: 'What we take, and what for',
    cards: [
        {
            id: 'account',
            title: 'Your account',
            summary: 'So we know it is you.',
            collects: ['Your mobile number and your name', 'When you signed in'],
            why: 'This is what keeps your farm and your work visible to you and to nobody else.',
            purposes: ['ACCOUNT_AUTHENTICATION', 'SECURITY'],
            dataCategories: ['IDENTITY_AND_CONTACT'],
        },
        {
            id: 'farmWork',
            title: 'Your farm work',
            summary: 'To keep safe what you tell us.',
            collects: [
                'The work, costs, labour, water and spraying you tell us about',
                'Your plots and crops',
                'The day the work happened',
            ],
            why: 'This is your farm’s account of itself, and it is yours. You can see it, correct it, and ask us to erase it at any time.',
            purposes: ['FARM_OPERATIONS', 'OFFLINE_SYNC'],
            dataCategories: ['FARM_WORK_RECORDS'],
        },
        {
            id: 'voiceUploads',
            title: 'Voice and uploads',
            summary: 'To understand what you said.',
            collects: [
                'The audio you speak',
                'The text that audio is turned into',
                'Photos and receipts you send',
            ],
            why: 'Your audio goes to our partner service to be turned into text. That, and nothing more. Whether the original audio is then kept is a separate decision that is yours — it is off to begin with, and we do not keep audio unless you turn it on.',
            purposes: ['VOICE_PROCESSING_FOR_WORK_RECORD'],
            dataCategories: ['VOICE_AUDIO_AND_TRANSCRIPT'],
        },
        {
            id: 'farmLocation',
            title: 'Your farm location',
            summary: 'To give you weather for your own field.',
            collects: [
                'The farm boundary you draw on the map',
                'Only if you allow it — your phone’s current location',
            ],
            why: 'Without a location we cannot give weather for your field specifically. Everything else in the app works without it.',
            purposes: ['PLOT_SPECIFIC_WEATHER'],
            dataCategories: ['FARM_LOCATION'],
        },
        {
            id: 'technical',
            title: 'Technical information',
            summary: 'To keep the app running and secure.',
            collects: [
                'Your phone type and the app version',
                'Error information if the app stops working',
                'What was saved on your phone while offline and sent later',
            ],
            why: 'This carries no name and no farm work. It only tells us where the app gets stuck.',
            purposes: ['SECURITY', 'OFFLINE_SYNC'],
            dataCategories: ['DEVICE_TECHNICAL'],
        },
    ],
    willNotDo: {
        heading: 'What we will not do',
        items: [
            'We will not sell your information.',
            'We will not give it to a bank, an insurer, a trader or any partner without your separate permission.',
            'We will not keep your voice recordings unless you turn that on.',
            'We will not use your work in advertising.',
            'We will not shut you out for refusing the microphone — everything can be entered by hand.',
            'We will not use this information for anything beyond the purposes listed above. If a new reason comes up, we will ask you again.',
        ],
    },
    rights: {
        heading: 'Your rights',
        items: [
            'You can see your information.',
            'You can correct anything that is wrong.',
            'You can ask us to erase it.',
            'You can withdraw a permission at any time — no harder than giving it. We will tell you plainly which services stop.',
            'You can complain to us, and after that to the Data Protection Board.',
        ],
        where: 'All of this lives under ‘Settings → Data & Privacy’.',
    },
    acceptanceMeaning: 'This one button does two separate things: you accept the Terms of Use, and you give permission to use your information for the purposes listed above — and for nothing else. The two are recorded separately, and you can withdraw them separately.',
    ageDeclaration: 'I am 18 years of age or older.',
    cta: 'I have read this and I agree',
    ctaDisabledHint: 'Tick the box above to continue.',
    pendingDisclosures: {
        heading: 'Still to be filled in',
        note: 'This is a pilot release. The items below are not settled yet. When they are, we will show you this notice again.',
        items: [
            'Legal company name — [not yet filled in]',
            'Office address — [not yet filled in]',
            'Privacy and grievance contact — [not yet filled in]',
            'Partner services that handle your information, and where they are — [not yet filled in]',
            'How long each kind of information is kept — [not yet filled in]',
            'Policy for users under 18 — [not yet filled in]',
        ],
    },
    links: { terms: 'Terms of Use', privacy: 'Privacy Policy' },
};

export const CONSENT_NOTICE: Record<NoticeLanguage, NoticeCopy> = { mr, en };

/** Every core purpose the gate's single tap grants, in a stable order. */
export const NOTICE_PURPOSE_CODES: readonly CorePurposeCode[] = CORE_PURPOSE_CODES;
/** Every data category the gate's single tap covers, in a stable order. */
export const NOTICE_DATA_CATEGORY_CODES: readonly CoreDataCategoryCode[] = CORE_DATA_CATEGORY_CODES;

/**
 * The notice, flattened to one deterministic string.
 *
 * This is what wave-4.2 hashes, and the hash is only meaningful if this covers exactly
 * what the farmer saw. So it walks every field the screen renders, in render order,
 * including the pending-disclosure placeholders — a notice with a blank where a company
 * name should be is a DIFFERENT notice from one with the name filled in, and the record
 * has to be able to tell them apart.
 *
 * Purpose/data-category codes are included too: they never appear on screen, but they
 * are what the record asserts was consented to, so a change to them must change the hash.
 */
export function canonicalNoticeText(language: NoticeLanguage): string {
    const c = CONSENT_NOTICE[language];
    const lines: string[] = [
        `notice-version:${NOTICE_VERSION}`,
        `terms-version:${TERMS_VERSION}`,
        `privacy-version:${PRIVACY_POLICY_VERSION}`,
        `language:${language}`,
        c.title,
        c.intro,
        c.purposeCardsHeading,
    ];

    for (const card of c.cards) {
        lines.push(`card:${card.id}`, card.title, card.summary, ...card.collects, card.why);
        lines.push(`purposes:${card.purposes.join(',')}`);
        lines.push(`categories:${card.dataCategories.join(',')}`);
    }

    lines.push(c.willNotDo.heading, ...c.willNotDo.items);
    lines.push(c.rights.heading, ...c.rights.items, c.rights.where);
    lines.push(c.acceptanceMeaning, c.ageDeclaration, c.cta, c.ctaDisabledHint);
    lines.push(c.pendingDisclosures.heading, c.pendingDisclosures.note, ...c.pendingDisclosures.items);
    lines.push(c.links.terms, c.links.privacy);

    return lines.join('\n');
}
