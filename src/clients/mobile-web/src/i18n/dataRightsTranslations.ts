// spec: data-principle-spine-2026-05-05/08.6
//
// Data rights namespace i18n bundle. Three locales (mr-IN, hi-IN,
// en-IN) per DPDP §5 + the Phase 06 OQ-7 convention: every value
// MUST carry the [LEGAL_REVIEW_PENDING] runtime prefix via
// tagLegalString(...) so the dev/CI UI surfaces the tag visibly until
// counsel removes it.
//
// Per OQ-6 verdict: erasure SLA copy is "48 hours" in all three
// languages; export copy is "24 hours" (per OQ-9 the URL TTL).
//
// spec: dfes-companion-2026-07-11 (erasure-honesty) — the erasure strings
// were rewritten on 2026-08-23. They previously promised "permanent" data
// deletion that "cannot be undone", and the recent-requests list rendered
// "पूर्ण / Completed" the moment the backend worker finished its automated
// pass. Neither was true: the worker anonymises ShramSafal rows but does
// not touch the account (public.users display_name + phone), does not
// delete the cold-tier raw audio, and the served privacy notice already
// says so in writing (public/legal/privacy_{en,mr}.md §6, note 3 — "those
// are removed by hand"). Founder ruling 2026-08-23 ITEM 4: the system must
// never tell a farmer something is deleted while ARVE knowingly retains
// the active copy.
//
// Two rules bind every edit below (founder ruling ITEM 12):
//   - mr / hi / en must be MATERIALLY IDENTICAL. Do not let one language
//     carry a promise another does not.
//   - Where they diverge, the reading MORE PROTECTIVE OF THE USER governs.
//     That is why the 48-hour commitment stays as written even though part
//     of the work is manual: shortening the promise to match the mechanism
//     would be the less protective direction. The manual step has to meet
//     48 hours, not the other way round.

import { tagLegalString } from './legalReviewMarker';

export type DataRightsLocale = 'mr-IN' | 'hi-IN' | 'en-IN';

export function toDataRightsLocale(lang: string | null | undefined): DataRightsLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    if (lang === 'hi' || lang === 'hi-IN') return 'hi-IN';
    return 'en-IN';
}

export interface DataRightsBundle {
    erasure: {
        title: string;
        intro: string;
        confirmHeading: string;
        confirmBody: string;
        submit: string;
        cancel: string;
        sla: string; // 48h per OQ-6
        error: string;
    };
    export: {
        title: string;
        intro: string;
        submit: string;
        sla: string; // 24h per OQ-9
        downloadLabel: string;
        error: string;
    };
    recent: {
        title: string;
        empty: string;
        statusRequested: string;
        statusInProgress: string;
        /**
         * Backend ErasureStatus.AwaitingManualCompletion. The automated pass
         * finished; personal data the request was meant to remove is still
         * held and a person at ARVE is removing it. MUST NOT read as done.
         */
        statusAwaitingManual: string;
        /** Only ever rendered for a request that is genuinely finished. */
        statusCompleted: string;
        statusFailed: string;
    };
}

// -- mr-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Marathi, awaiting counsel.
const mr: DataRightsBundle = {
    erasure: {
        title: tagLegalString('माझा डेटा मिटवा'),
        intro: tagLegalString('तुमची वैयक्तिक माहिती मिटवण्याची विनंती करा. तुमचं नाव शेतनोंदींवरून काढलं जातं आणि जतन केलेली आवाज-रेकॉर्डिंग नष्ट केली जातात. यातलं काही काम ARVE मधली व्यक्ती हाताने करते, त्यामुळे तुम्ही बटण दाबताच सगळं होत नाही.'),
        confirmHeading: tagLegalString('खात्री आहे का?'),
        confirmBody: tagLegalString('तुमचं नाव आणि वैयक्तिक टिपा शेतनोंदींवरून काढल्या जातात; शेताचे आकडे तुमच्याशी न जोडता तसेच राहतात. जतन केलेली आवाज-रेकॉर्डिंग नष्ट केली जातात. सर्व्हरवरच्या मूळ आवाज-फाइल्स आणि तुमचं खातं ARVE मधली व्यक्ती हाताने काढते — आपोआप नाही. एकदा झाल्यावर हे परत करता येणार नाही.'),
        submit: tagLegalString('हो, मिटवा'),
        cancel: tagLegalString('नाही, रद्द करा'),
        sla: tagLegalString('तुमची विनंती मिळाली आहे. ४८ तासांत आम्ही ती पूर्ण करतो. शेवटचा भाग ARVE मधली व्यक्ती हाताने करते, त्यामुळे हे वाचता क्षणी काम पूर्ण झालेलं नाही.'),
        error: tagLegalString('विनंती पाठवता आली नाही. पुन्हा प्रयत्न करा.'),
    },
    export: {
        title: tagLegalString('माझा डेटा निर्यात करा'),
        intro: tagLegalString('तुमच्या सर्व डेटाची एक प्रत डाउनलोडसाठी तयार केली जाईल.'),
        submit: tagLegalString('निर्यात तयार करा'),
        sla: tagLegalString('तुमचा डेटा एक्सपोर्ट २४ तासांत तयार होईल; डाउनलोड लिंकसह सूचना मिळेल.'),
        downloadLabel: tagLegalString('डाउनलोड करा'),
        error: tagLegalString('विनंती पाठवता आली नाही. पुन्हा प्रयत्न करा.'),
    },
    recent: {
        title: tagLegalString('अलीकडील विनंत्या'),
        empty: tagLegalString('अद्याप कोणतीही विनंती नाही.'),
        statusRequested: tagLegalString('प्राप्त झाली'),
        statusInProgress: tagLegalString('चालू आहे'),
        // NB: deliberately avoids the word पूर्ण ("complete") — this row must
        // not read as done even at a glance, or in a substring match.
        statusAwaitingManual: tagLegalString('काही भाग बाकी — ARVE मधली व्यक्ती हाताने करत आहे'),
        statusCompleted: tagLegalString('पूर्ण'),
        statusFailed: tagLegalString('अयशस्वी'),
    },
};

// -- hi-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Hindi, awaiting counsel.
const hi: DataRightsBundle = {
    erasure: {
        title: tagLegalString('मेरा डेटा मिटाएं'),
        intro: tagLegalString('अपनी निजी जानकारी मिटाने का अनुरोध करें। आपका नाम खेती के रिकॉर्ड से हटा दिया जाता है और सहेजी गई आवाज़ रिकॉर्डिंग मिटा दी जाती हैं। इसमें कुछ काम ARVE का व्यक्ति हाथ से करता है, इसलिए बटन दबाते ही सब कुछ नहीं हो जाता।'),
        confirmHeading: tagLegalString('क्या आप निश्चित हैं?'),
        confirmBody: tagLegalString('आपका नाम और निजी टिप्पणियाँ खेती के रिकॉर्ड से हटा दी जाती हैं; खेत के आँकड़े आपसे जुड़े बिना बने रहते हैं। सहेजी गई आवाज़ रिकॉर्डिंग मिटा दी जाती हैं। सर्वर पर रखी मूल आवाज़ फ़ाइलें और आपका खाता ARVE का व्यक्ति हाथ से हटाता है — अपने आप नहीं। एक बार हो जाने पर यह वापस नहीं किया जा सकता।'),
        submit: tagLegalString('हाँ, मिटाएं'),
        cancel: tagLegalString('नहीं, रद्द करें'),
        sla: tagLegalString('आपका अनुरोध प्राप्त हो गया है। हम इसे 48 घंटों में पूरा करते हैं। आख़िरी हिस्सा ARVE का व्यक्ति हाथ से करता है, इसलिए यह पढ़ते समय काम पूरा नहीं हुआ है।'),
        error: tagLegalString('अनुरोध भेजा नहीं जा सका। फिर से कोशिश करें।'),
    },
    export: {
        title: tagLegalString('मेरा डेटा निर्यात करें'),
        intro: tagLegalString('आपके सभी डेटा की एक प्रति डाउनलोड के लिए तैयार की जाएगी।'),
        submit: tagLegalString('निर्यात तैयार करें'),
        sla: tagLegalString('आपका डेटा एक्सपोर्ट 24 घंटों में तैयार होगा; डाउनलोड लिंक के साथ सूचना मिलेगी।'),
        downloadLabel: tagLegalString('डाउनलोड करें'),
        error: tagLegalString('अनुरोध भेजा नहीं जा सका। फिर से कोशिश करें।'),
    },
    recent: {
        title: tagLegalString('हाल के अनुरोध'),
        empty: tagLegalString('अभी तक कोई अनुरोध नहीं।'),
        statusRequested: tagLegalString('प्राप्त'),
        statusInProgress: tagLegalString('प्रगति पर'),
        // Mirrors mr: avoids पूर्ण / पूरा so the row cannot read as done.
        statusAwaitingManual: tagLegalString('कुछ हिस्सा बाकी — ARVE का व्यक्ति हाथ से कर रहा है'),
        statusCompleted: tagLegalString('पूर्ण'),
        statusFailed: tagLegalString('विफल'),
    },
};

// -- en-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — English, awaiting counsel.
const en: DataRightsBundle = {
    erasure: {
        title: tagLegalString('Erase my data'),
        intro: tagLegalString('Ask us to erase your personal data. Your name is taken off your farm records and your saved voice recordings are deleted. Part of this work is done by a person at ARVE, so not all of it happens the moment you tap.'),
        confirmHeading: tagLegalString('Are you sure?'),
        confirmBody: tagLegalString('Your name and your personal notes are removed from your farm records; the farm figures stay, no longer attached to you. Your saved voice recordings are deleted. The original voice recordings on our servers, and your account itself, are removed by a person at ARVE — not automatically. Once it is done it cannot be undone.'),
        submit: tagLegalString('Yes, erase'),
        cancel: tagLegalString('No, cancel'),
        sla: tagLegalString('Request received. We complete it within 48 hours. The last part is done by a person at ARVE, so the work is not finished at the moment you read this.'),
        error: tagLegalString('Could not submit request. Please try again.'),
    },
    export: {
        title: tagLegalString('Export my data'),
        intro: tagLegalString('A copy of all your data will be prepared for download.'),
        submit: tagLegalString('Generate export'),
        sla: tagLegalString('Your data export will be ready within 24 hours; you will receive a notification with a download link.'),
        downloadLabel: tagLegalString('Download'),
        error: tagLegalString('Could not submit request. Please try again.'),
    },
    recent: {
        title: tagLegalString('Recent requests'),
        empty: tagLegalString('No requests yet.'),
        statusRequested: tagLegalString('Received'),
        statusInProgress: tagLegalString('In progress'),
        statusAwaitingManual: tagLegalString('Part still remaining — a person at ARVE is doing it by hand'),
        statusCompleted: tagLegalString('Completed'),
        statusFailed: tagLegalString('Failed'),
    },
};

export const DATA_RIGHTS_BUNDLES: Record<DataRightsLocale, DataRightsBundle> = {
    'mr-IN': mr,
    'hi-IN': hi,
    'en-IN': en,
};

export function tDataRights(locale: DataRightsLocale, key: string): string {
    const parts = key.split('.');
    let cur: unknown = DATA_RIGHTS_BUNDLES[locale];
    for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
            cur = (cur as Record<string, unknown>)[p];
        } else {
            return key;
        }
    }
    return typeof cur === 'string' ? cur : key;
}
