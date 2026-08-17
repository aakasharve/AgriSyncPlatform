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
// the screen CHROME only (the language switcher, the failure notice); nothing in the
// chrome makes a legal statement.
//
// ── COMPRESSION PASS, founder direction 2026-08-17 ──────────────────────────────────
// The founder read the previous notice and said: "very little text that meant all of
// this... no one reads it but it's our duty to display all this and make it clear."
// So this revision cuts LENGTH, never DISCLOSURES. Every purpose category, every
// "we will not do" line and every right survives; each is now one line instead of a
// paragraph, and the five purpose cards no longer hide half their content behind an
// expander — a disclosure that needs a tap to appear is a disclosure a farmer can miss.
// `data` and `purpose` stay two fields on purpose: the DPDP Rules ask for an ITEMISED
// description of the personal data alongside the purpose of each use, so the itemisation
// has to remain its own addressable, hashable thing even though it renders on one line.
//
// ── THE THREE NAMES ─────────────────────────────────────────────────────────────────
// `brandLine` is the one sentence that untangles them, because nothing else on the
// screen does: श्रम सफल / Shram Safal is the product the farmer holds, AgriSync is the
// platform it runs on, and Agriryot Value Enterprises Private Limited is the company
// behind both. The company name is carried in Latin script in BOTH languages — it is a
// registered legal name, and transliterating a registered name is inventing one.
// Tailwind's `font-sans` stack resolves a mixed line per glyph (Latin → DM Sans,
// Devanagari → Noto Sans Devanagari), so that line reads correctly in Marathi.
//
// ── LEGAL_REVIEW_PENDING ────────────────────────────────────────────────────────────
// Per DS-015 / the LEGAL_REVIEW_PENDING convention, this copy is derived from the
// founder's own words (docs/superpowers/specs/2026-08-16-consent-gate-founder-copy.md)
// and has NOT been through counsel. The marker is carried once, here, as
// `NOTICE_LEGAL_REVIEW_PENDING` rather than as a `[LEGAL_REVIEW_PENDING] ` prefix on
// every string: prefixing would put the tag in front of every line a farmer reads, and
// a notice that is hard to read is a worse consent notice, not a safer one. The CI gate
// greps for the token, so the prod-deploy block still fires while this constant exists.
//
// 🛑 WHAT IS STILL UNKNOWN IS OMITTED, NOT PLACEHELD. The data fiduciary's identity,
// CIN, registered office and contact are now real and appear below verbatim. A
// grievance phone number, a named DPO, retention periods, the processor list and the
// under-18 policy are still genuinely unsettled — so this notice says nothing about
// them rather than showing a farmer an empty bracket. Omission is honest; a visible
// "[not yet filled in]" is a screen telling him his consent is provisional. Until those
// land, no wording here or anywhere else may claim DPDP compliance.
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
 *
 * `notice-2026-08-17.1` — the compression pass. The words a farmer accepts are
 * materially different from `notice-2026-08-16.2`, so anyone who accepted the old text
 * must NOT be recorded as having accepted this one.
 */
export const NOTICE_VERSION = 'notice-2026-08-17.1';
export const PRIVACY_POLICY_VERSION = 'privacy-2026-08-16.1';
export const TERMS_VERSION = 'terms-2026-08-16.1';

/**
 * The data fiduciary, as registered. One copy, shared by both languages, because a
 * legal identity that differs between two translations of the same notice is a defect.
 * Only facts that are actually known appear here.
 */
export const DATA_FIDUCIARY = {
    legalName: 'Agriryot Value Enterprises Private Limited',
    cin: 'U62099PN2026PTC256337',
    registeredOffice:
        'H. No. 2992, Near Indira Gandhi Bhaji Market, Pandharpur, Dist. Solapur, Maharashtra – 413304',
    contact: 'arvesystems@gmail.com',
} as const;

export type NoticeLanguage = 'mr' | 'en';

/** One data-purpose row. Always fully visible — nothing here is behind an expander. */
export interface PurposeCard {
    /** Stable id — used for test targeting. */
    id: 'account' | 'farmWork' | 'voiceUploads' | 'farmLocation' | 'technical';
    title: string;
    /** The ITEMISED personal data. Its own field because the Rules ask for the itemisation. */
    data: string;
    /** What that data is used for. Rendered on the same line as `data`. */
    purpose: string;
    /** Codes this row maps onto in the stored record. Never shown to the farmer. */
    purposes: CorePurposeCode[];
    dataCategories: CoreDataCategoryCode[];
}

export interface NoticeCopy {
    title: string;
    intro: string;
    /** Shram Safal ← AgriSync ← ARVE, in one sentence. See the header note. */
    brandLine: string;
    purposeCardsHeading: string;
    cards: PurposeCard[];
    willNotDo: { heading: string; items: string[] };
    /** Processor CATEGORIES — the founder's own sentence. No processor is named, because
     *  the list is not settled; naming one we have not confirmed would be a fabrication. */
    processors: string;
    rights: { heading: string; where: string; items: string[]; withdrawal: string };
    /** Who the farmer is actually dealing with. Facts only. */
    entity: { heading: string; cinLabel: string; officeLabel: string; contactLabel: string };
    /** What the single tap actually does. Disclosed, because one button writing two
     *  records is only honest if the farmer is told that is what it does. */
    acceptanceMeaning: string;
    ageDeclaration: string;
    cta: string;
    ctaDisabledHint: string;
    links: { terms: string; privacy: string };
}

// ── मराठी ───────────────────────────────────────────────────────────────────────────
const mr: NoticeCopy = {
    title: 'सुरू करण्याआधी',
    intro: 'तुमच्या शेताची माहिती तुमच्याच ताब्यात राहते. ॲप चालण्यासाठी फक्त खालील माहिती वापरतो.',
    brandLine: 'श्रम सफल हे Agriryot Value Enterprises Private Limited चं ॲप आहे; ते AgriSync प्लॅटफॉर्मवर चालतं.',
    purposeCardsHeading: 'कोणती माहिती, कशासाठी',
    cards: [
        {
            id: 'account',
            title: 'तुमचं खातं',
            data: 'मोबाईल नंबर, नाव, खात्याची माहिती',
            purpose: 'लॉगिन, OTP आणि सुरक्षिततेसाठी',
            purposes: ['ACCOUNT_AUTHENTICATION', 'SECURITY'],
            dataCategories: ['IDENTITY_AND_CONTACT'],
        },
        {
            id: 'farmWork',
            title: 'शेतातलं काम',
            data: 'शेत, प्लॉट, पीक, कामं, मजूर, खर्च, उत्पन्न, टीम',
            purpose: 'रोजचं काम समजून हिशोब स्पष्ट दाखवण्यासाठी',
            purposes: ['FARM_OPERATIONS', 'OFFLINE_SYNC'],
            dataCategories: ['FARM_WORK_RECORDS'],
        },
        {
            id: 'voiceUploads',
            title: 'आवाज आणि जोडलेली माहिती',
            data: 'तुम्ही बोललेलं, लिहिलेलं, फोटो, कागदपत्रं',
            purpose: 'काम समजून योग्य ठिकाणी मांडण्यासाठी. माईक तुम्ही सुरू केल्यावरच वापरला जातो',
            purposes: ['VOICE_PROCESSING_FOR_WORK_RECORD'],
            dataCategories: ['VOICE_AUDIO_AND_TRANSCRIPT'],
        },
        {
            id: 'farmLocation',
            title: 'शेताची जागा',
            data: 'शेताची जागा किंवा हद्द',
            purpose: 'त्या शेतापुरतं हवामान दाखवण्यासाठी. फोनचा सतत मागोवा घेतला जात नाही',
            purposes: ['PLOT_SPECIFIC_WEATHER'],
            dataCategories: ['FARM_LOCATION'],
        },
        {
            id: 'technical',
            title: 'तांत्रिक माहिती',
            data: 'फोन, ॲप, सिंक आणि सुरक्षेची मर्यादित माहिती',
            purpose: 'नेटवर्क नसताना काम सुरक्षित ठेवून नंतर सिंक करण्यासाठी आणि गैरवापर शोधण्यासाठी',
            purposes: ['SECURITY', 'OFFLINE_SYNC'],
            dataCategories: ['DEVICE_TECHNICAL'],
        },
    ],
    willNotDo: {
        heading: 'आम्ही काय करणार नाही',
        items: [
            'तुमची वैयक्तिक माहिती विकणार नाही.',
            'परवानगीशिवाय जाहिरातींसाठी वापरणार नाही.',
            'तुमचा आवाज AI मॉडेल शिकवण्यासाठी वापरणार नाही.',
            'तुमच्या माहितीवरून कर्ज, विमा किंवा बाजाराचे निर्णय घेणार नाही — त्यासाठी वेगळी स्पष्ट परवानगी मागू.',
        ],
    },
    processors: 'OTP, सुरक्षित क्लाउड, आवाज समजणे, हवामान, फाइल, सूचना आणि तांत्रिक मदत — एवढ्याच कामांसाठी काही विश्वासू सेवा पुरवठादार मर्यादित माहिती हाताळू शकतात, ठरलेल्या कामापुरतीच.',
    rights: {
        heading: 'तुमचे हक्क',
        where: 'Settings → Data & Privacy मध्ये:',
        items: [
            'दिलेली परवानगी पाहा किंवा मागे घ्या.',
            'माहिती पाहा, दुरुस्त करा किंवा डाउनलोड करा.',
            'खातं आणि माहिती हटवायची विनंती करा.',
            'तक्रार करा, किंवा तुमच्या वतीने हक्क वापरायला कुणाला नेमा.',
        ],
        withdrawal: 'मुख्य परवानगी मागे घेतल्यास काही किंवा सर्व सुविधा बंद होऊ शकतात. आधी कायदेशीररीत्या झालेली प्रक्रिया रद्द होत नाही; कायद्याने आवश्यक तेवढी माहिती ठरावीक काळ ठेवावी लागू शकते.',
    },
    entity: {
        heading: 'ही सेवा कोण चालवतं',
        cinLabel: 'CIN',
        officeLabel: 'पत्ता',
        contactLabel: 'संपर्क',
    },
    acceptanceMeaning: '‘मान्य आहे — पुढे चला’ म्हणजे (१) वापराच्या अटी मान्य, आणि (२) वरच्या कामांपुरतीच माहिती वापरायला स्वतंत्र संमती. दोन्ही वेगळ्या साठवल्या जातात आणि तितक्याच सोप्या पद्धतीने मागे घेता येतात.',
    ageDeclaration: 'माझं वय १८ वर्षे किंवा त्याहून जास्त आहे.',
    cta: 'मान्य आहे — पुढे चला',
    ctaDisabledHint: 'पुढे जाण्यासाठी वरची खूण करा.',
    links: { terms: 'वापराच्या अटी', privacy: 'गोपनीयता धोरण' },
};

// ── English ─────────────────────────────────────────────────────────────────────────
const en: NoticeCopy = {
    title: 'Before you begin',
    intro: 'Your farm data stays under your control. Shram Safal uses only the information below.',
    brandLine: 'Shram Safal is an app by Agriryot Value Enterprises Private Limited, built on the AgriSync platform.',
    purposeCardsHeading: 'What we use, and why',
    cards: [
        {
            id: 'account',
            title: 'Your account',
            data: 'Mobile number, name, account details',
            purpose: 'for OTP login, access and security',
            purposes: ['ACCOUNT_AUTHENTICATION', 'SECURITY'],
            dataCategories: ['IDENTITY_AND_CONTACT'],
        },
        {
            id: 'farmWork',
            title: 'Your farm work',
            data: 'Farm, plot, crop, work, labour, cost, income, team',
            purpose: 'to understand your daily work and show clear summaries',
            purposes: ['FARM_OPERATIONS', 'OFFLINE_SYNC'],
            dataCategories: ['FARM_WORK_RECORDS'],
        },
        {
            id: 'voiceUploads',
            title: 'Voice and uploads',
            data: 'What you speak, type, photograph or upload',
            purpose: 'to understand your work and place it correctly. The microphone runs only when you start it',
            purposes: ['VOICE_PROCESSING_FOR_WORK_RECORD'],
            dataCategories: ['VOICE_AUDIO_AND_TRANSCRIPT'],
        },
        {
            id: 'farmLocation',
            title: 'Farm location',
            data: 'Your farm location or boundary',
            purpose: 'to give weather for that field. Your phone is not continuously tracked',
            purposes: ['PLOT_SPECIFIC_WEATHER'],
            dataCategories: ['FARM_LOCATION'],
        },
        {
            id: 'technical',
            title: 'Technical information',
            data: 'Limited device, app, sync and security information',
            purpose: 'to protect offline work, sync it later and detect misuse',
            purposes: ['SECURITY', 'OFFLINE_SYNC'],
            dataCategories: ['DEVICE_TECHNICAL'],
        },
    ],
    willNotDo: {
        heading: 'What we will not do',
        items: [
            'We will not sell your personal data.',
            'We will not use it for advertising without separate permission.',
            'We will not use your voice to train AI models without separate permission.',
            'We will not make lending, insurance or market decisions from your data — that needs separate, specific consent.',
        ],
    },
    processors: 'Trusted service providers may handle limited information only for OTP, secure cloud hosting, speech processing, weather, file storage, notifications and technical support — and only for that assigned purpose.',
    rights: {
        heading: 'Your rights',
        where: 'From Settings → Data & Privacy:',
        items: [
            'Review or withdraw your consent.',
            'Access, correct or download your information.',
            'Request deletion of your account and data.',
            'Raise a grievance, or nominate someone to act for you.',
        ],
        withdrawal: 'Withdrawing essential consent may disable some or all services. It does not undo processing already lawfully done; limited information may be retained where the law requires it.',
    },
    entity: {
        heading: 'Who runs this service',
        cinLabel: 'CIN',
        officeLabel: 'Office',
        contactLabel: 'Contact',
    },
    acceptanceMeaning: 'Choosing ‘Agree and Continue’ means (1) you accept the Terms of Use, and (2) you separately consent to use of only the data needed for the purposes above. The two are stored separately and can be withdrawn just as easily.',
    ageDeclaration: 'I am 18 years of age or older.',
    cta: 'Agree and Continue',
    ctaDisabledHint: 'Tick the box above to continue.',
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
 * including the data fiduciary's identity — a notice naming a different company is a
 * DIFFERENT notice, and the record has to be able to tell them apart.
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
        c.brandLine,
        c.purposeCardsHeading,
    ];

    for (const card of c.cards) {
        lines.push(`card:${card.id}`, card.title, card.data, card.purpose);
        lines.push(`purposes:${card.purposes.join(',')}`);
        lines.push(`categories:${card.dataCategories.join(',')}`);
    }

    lines.push(c.willNotDo.heading, ...c.willNotDo.items);
    lines.push(c.processors);
    lines.push(c.rights.heading, c.rights.where, ...c.rights.items, c.rights.withdrawal);
    lines.push(
        c.entity.heading,
        DATA_FIDUCIARY.legalName,
        `${c.entity.cinLabel}:${DATA_FIDUCIARY.cin}`,
        `${c.entity.officeLabel}:${DATA_FIDUCIARY.registeredOffice}`,
        `${c.entity.contactLabel}:${DATA_FIDUCIARY.contact}`,
    );
    lines.push(c.acceptanceMeaning, c.ageDeclaration, c.cta, c.ctaDisabledHint);
    lines.push(c.links.terms, c.links.privacy);

    return lines.join('\n');
}
