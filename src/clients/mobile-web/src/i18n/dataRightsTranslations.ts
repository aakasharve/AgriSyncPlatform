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
        statusCompleted: string;
        statusFailed: string;
    };
}

// -- mr-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Marathi, awaiting counsel.
const mr: DataRightsBundle = {
    erasure: {
        title: tagLegalString('माझा डेटा मिटवा'),
        intro: tagLegalString('तुमचा डेटा कायमचा मिटवण्याची विनंती. ही क्रिया परत करता येणार नाही.'),
        confirmHeading: tagLegalString('खात्री आहे का?'),
        confirmBody: tagLegalString('तुमचा सर्व वैयक्तिक डेटा अनामिक केला जाईल. शेतीचे रेकॉर्ड शिल्लक राहतील पण तुमचे नाव त्यांच्याशी जोडले जाणार नाही.'),
        submit: tagLegalString('हो, मिटवा'),
        cancel: tagLegalString('नाही, रद्द करा'),
        sla: tagLegalString('तुमची विनंती मिळाली आहे. ४८ तासांत प्रक्रिया पूर्ण होईल.'),
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
        statusCompleted: tagLegalString('पूर्ण'),
        statusFailed: tagLegalString('अयशस्वी'),
    },
};

// -- hi-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Hindi, awaiting counsel.
const hi: DataRightsBundle = {
    erasure: {
        title: tagLegalString('मेरा डेटा मिटाएं'),
        intro: tagLegalString('अपना डेटा हमेशा के लिए मिटाने का अनुरोध। यह क्रिया पलटी नहीं जा सकती।'),
        confirmHeading: tagLegalString('क्या आप निश्चित हैं?'),
        confirmBody: tagLegalString('आपका सारा व्यक्तिगत डेटा गुमनाम कर दिया जाएगा। खेती के रिकॉर्ड बने रहेंगे लेकिन आपका नाम उनसे नहीं जुड़ा होगा।'),
        submit: tagLegalString('हाँ, मिटाएं'),
        cancel: tagLegalString('नहीं, रद्द करें'),
        sla: tagLegalString('आपका अनुरोध प्राप्त हो गया है। 48 घंटों में संसाधित किया जाएगा।'),
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
        statusCompleted: tagLegalString('पूर्ण'),
        statusFailed: tagLegalString('विफल'),
    },
};

// -- en-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — English, awaiting counsel.
const en: DataRightsBundle = {
    erasure: {
        title: tagLegalString('Erase my data'),
        intro: tagLegalString('Request permanent erasure of your personal data. This action cannot be undone.'),
        confirmHeading: tagLegalString('Are you sure?'),
        confirmBody: tagLegalString('All your personal data will be anonymized. Farm records remain but will not be linked to your name.'),
        submit: tagLegalString('Yes, erase'),
        cancel: tagLegalString('No, cancel'),
        sla: tagLegalString('Request received. Processing within 48 hours.'),
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
