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
// ── PLAIN-DOCUMENT PASS, founder direction 2026-08-17 (second) ──────────────────────
// "remove office details and other details such as CIN Number and all — that's not
// needed for public facing app". So the REGISTERED OFFICE and the CIN come off the
// gate. They are not deleted — they stay on `DATA_FIDUCIARY` below, unrendered, and
// they are OWED to the full privacy notice the gate links to.
//
// Because they are no longer on screen they are also no longer in
// `canonicalNoticeText`. That is not an oversight: the hash is only worth something if
// it covers exactly what the farmer was shown, so a fact that left the screen must
// leave the serialisation in the same commit, and the version must move with it.
//
// What did NOT come off, and may not: the company's LEGAL NAME and a CONTACT. A notice
// that will not say who is processing the data, or how to reach them, is not a consent
// notice — it is a splash screen. Every purpose category, every "we will not do" line,
// every right and the withdrawal consequence also stay in full.
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
// 🛑 WHAT IS STILL UNKNOWN IS OMITTED, NOT PLACEHELD. The data fiduciary's legal name
// and contact are real and appear on screen verbatim. A grievance phone number, a named
// DPO, retention periods, the processor list and the under-18 policy are still
// genuinely unsettled — so this notice says nothing about
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
 * `notice-2026-08-17.2` — the plain-document pass. The CIN and the registered office
 * left both the screen and the canonical text, so the words a farmer accepts are
 * materially different from `notice-2026-08-17.1`; anyone who accepted that text must
 * NOT be recorded as having accepted this one.
 *
 * `notice-2026-08-17.3` — the DECLINE pass. The screen now states, in the farmer's own
 * language, what happens if he does not agree. That is a material statement about the
 * consequence of refusing consent, so it is displayed, serialised and versioned like
 * every other statement here. A notice whose only affordance was "yes" was describing a
 * choice it did not offer.
 *
 * `notice-2026-08-17.4` — the BOARD-COMPLAINT pass. DPDP Act 2023 §5(1) requires the
 * notice to inform the Data Principal of three things; this notice carried two. It
 * described the personal data and the purposes, and it described how to exercise his
 * rights — but not §5(1)(c), THE MANNER OF MAKING A COMPLAINT TO THE DATA PROTECTION
 * BOARD OF INDIA. `rights.boardComplaint` adds it.
 *
 * The bump is not optional book-keeping. The words a farmer accepts are now materially
 * different, and a farmer who accepted `.3` was never told he could go to the Board.
 * Recording him against `.4` would assert he was shown a disclosure he never saw — the
 * exact failure the hash and the version exist to prevent.
 */
export const NOTICE_VERSION = 'notice-2026-08-17.4';
export const PRIVACY_POLICY_VERSION = 'privacy-2026-08-16.1';
export const TERMS_VERSION = 'terms-2026-08-16.1';

/**
 * The data fiduciary, as registered. One copy, shared by both languages, because a
 * legal identity that differs between two translations of the same notice is a defect.
 * Only facts that are actually known appear here.
 *
 * `legalName` and `contact` are ON the gate — a farmer must be able to see who holds
 * his data and how to reach them.
 *
 * `cin` and `registeredOffice` are NOT on the gate (founder direction 2026-08-17) and
 * are NOT in `canonicalNoticeText`. They are kept here rather than deleted because they
 * are owed to the full privacy notice — see `OWED_TO_FULL_PRIVACY_NOTICE`.
 */
export const DATA_FIDUCIARY = {
    legalName: 'Agriryot Value Enterprises Private Limited',
    cin: 'U62099PN2026PTC256337',
    registeredOffice:
        'H. No. 2992, Near Indira Gandhi Bhaji Market, Pandharpur, Dist. Solapur, Maharashtra – 413304',
    contact: 'arvesystems@gmail.com',
} as const;

/**
 * Facts that left the gate but still have to appear SOMEWHERE a farmer can reach.
 *
 * The gate links to `/legal/privacy`. That route has no target in this repo today —
 * there is no privacy-policy page or document under `src/clients/mobile-web` (the only
 * files under `public/consent/` are the wave-4.3 OPTIONAL-consent agreements, a
 * different document). So this is a standing debt, named here so it cannot be lost:
 * when the full privacy notice is authored, the CIN and the registered office go into
 * it. Neither is a secret; both are public register facts.
 */
export const OWED_TO_FULL_PRIVACY_NOTICE = ['cin', 'registeredOffice'] as const;

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
    /**
     * `boardComplaint` is the DPDP §5(1)(c) disclosure — his right to take a complaint
     * to the Data Protection Board of India. It is a sibling of `withdrawal` rather than
     * an entry in `items` on purpose: `where` promises that the items above it are done
     * from `Settings → Data & Privacy`, and a complaint to the Board is not. Filing it
     * under that promise would be a false statement about where to go.
     *
     * It states the RIGHT and nothing more. No Board address, email, portal URL or form
     * appears here, because none has been verified — and an invented mechanism is worse
     * than a named right, since a farmer would act on it. The Board's own procedure is
     * the Board's to publish.
     *
     * The name stays in Latin script in both languages, for the same reason the
     * company's does: it is a statutory body's registered name, and transliterating a
     * registered name is inventing one.
     */
    rights: {
        heading: string;
        where: string;
        items: string[];
        withdrawal: string;
        boardComplaint: string;
    };
    /**
     * Who the farmer is actually dealing with. Facts only, and only the two a public
     * app screen needs: the legal name (rendered from `DATA_FIDUCIARY`) and a contact.
     * There is deliberately no `cinLabel` / `officeLabel` — a label with nothing to
     * label is how a removed field creeps back.
     */
    entity: { heading: string; contactLabel: string };
    /** What the single tap actually does. Disclosed, because one button writing two
     *  records is only honest if the farmer is told that is what it does. */
    acceptanceMeaning: string;
    ageDeclaration: string;
    cta: string;
    ctaDisabledHint: string;
    /**
     * The REFUSAL, and what refusing costs him.
     *
     * `label` is the decline action itself. It renders at the same type size as the CTA
     * and across the same full width, because accept and decline have to be offered with
     * equal prominence — a notice that shows only "agree" is a dark pattern wearing a
     * legal notice's clothes, and this screen's own `willNotDo` promises are worth
     * nothing if the screen itself pulls one.
     *
     * `consequence` is what he is told the moment he taps it: that the app cannot be used
     * without this consent, that nothing about him was saved, and how to change his mind.
     * It is copy on the notice — not chrome — because "what happens if you say no" is a
     * disclosure about the consent itself, so it is hashed with everything else.
     */
    decline: { label: string; consequence: string };
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
        boardComplaint: 'आमच्याकडे तक्रार करूनही समाधान न झाल्यास, Data Protection Board of India कडे तक्रार करण्याचा तुम्हाला हक्क आहे.',
    },
    entity: {
        heading: 'ही सेवा कोण चालवतं',
        contactLabel: 'संपर्क',
    },
    acceptanceMeaning: '‘मान्य आहे — पुढे चला’ म्हणजे (१) वापराच्या अटी मान्य, आणि (२) वरच्या कामांपुरतीच माहिती वापरायला स्वतंत्र संमती. दोन्ही वेगळ्या साठवल्या जातात आणि तितक्याच सोप्या पद्धतीने मागे घेता येतात.',
    ageDeclaration: 'माझं वय १८ वर्षे किंवा त्याहून जास्त आहे.',
    cta: 'मान्य आहे — पुढे चला',
    ctaDisabledHint: 'पुढे जाण्यासाठी वरची खूण करा.',
    decline: {
        label: 'मान्य नाही',
        consequence: 'या संमतीशिवाय श्रम सफल वापरता येणार नाही. तुमची कोणतीही माहिती साठवली गेलेली नाही. विचार बदलल्यास वरची खूण करून पुढे चला.',
    },
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
        boardComplaint: 'If we do not resolve your grievance, you have the right to complain to the Data Protection Board of India.',
    },
    entity: {
        heading: 'Who runs this service',
        contactLabel: 'Contact',
    },
    acceptanceMeaning: 'Choosing ‘Agree and Continue’ means (1) you accept the Terms of Use, and (2) you separately consent to use of only the data needed for the purposes above. The two are stored separately and can be withdrawn just as easily.',
    ageDeclaration: 'I am 18 years of age or older.',
    cta: 'Agree and Continue',
    ctaDisabledHint: 'Tick the box above to continue.',
    decline: {
        label: 'I do not agree',
        consequence: 'Shram Safal cannot be used without this consent. Nothing about you has been saved. If you change your mind, tick the box above and continue.',
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
 * including the data fiduciary's legal name — a notice naming a different company is a
 * DIFFERENT notice, and the record has to be able to tell them apart.
 *
 * It does NOT carry the CIN or the registered office, because since 2026-08-17 the gate
 * does not show them. Serialising a fact the farmer never saw would make the hash claim
 * more than the screen did.
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
    // DPDP §5(1)(c). A statutory disclosure that is on the screen and not in here would
    // leave the stored hash describing a notice the farmer was never shown.
    lines.push(c.rights.boardComplaint);
    lines.push(
        c.entity.heading,
        DATA_FIDUCIARY.legalName,
        `${c.entity.contactLabel}:${DATA_FIDUCIARY.contact}`,
    );
    lines.push(c.acceptanceMeaning, c.ageDeclaration, c.cta, c.ctaDisabledHint);
    // The refusal and its stated consequence are part of the notice: what he was told
    // would happen if he said no is as much a disclosure as what happens if he says yes.
    lines.push(c.decline.label, c.decline.consequence);
    lines.push(c.links.terms, c.links.privacy);

    return lines.join('\n');
}
