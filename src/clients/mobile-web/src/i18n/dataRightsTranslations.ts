// spec: data-principle-spine-2026-05-05/08.6
//
// Data rights namespace i18n bundle. Two locales (mr-IN,
// en-IN) per DPDP §5. Strings render exactly as written: no visible review
// prefix is added at runtime. Copy review status is tracked in the private
// review records.
//
// Timing wording must describe what the system actually does. The erasure
// worker polls every 60s but nothing enforces a deadline, and the export worker
// cannot currently issue a download link (ExportWorker.NoSignerReason), so
// neither screen states a number of hours.

export type DataRightsLocale = 'mr-IN' | 'en-IN';

export function toDataRightsLocale(lang: string | null | undefined): DataRightsLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    // Hindi is not offered. A stored or server-sent 'hi' falls back to Marathi,
    // the app default (same rule as LanguageContext / LanguageSyncFromServer).
    if (lang === 'hi' || lang === 'hi-IN') return 'mr-IN';
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
const mr: DataRightsBundle = {
    erasure: {
        title: 'माझा डेटा मिटवा',
        intro: 'तुमचे खाते आणि वैयक्तिक माहिती मिटवण्याची विनंती. ही क्रिया परत करता येणार नाही.',
        confirmHeading: 'खात्री आहे का?',
        confirmBody: 'तुमचे खाते आणि वैयक्तिक माहिती काढली किंवा अनामिक केली जाईल. शेतीचे रेकॉर्ड शिल्लक राहतील पण तुमचे नाव त्यांच्याशी जोडले जाणार नाही. सर्व्हरवर साठवलेले काही आवाज अजून आपोआप मिटवता येत नाहीत.',
        submit: 'हो, मिटवा',
        cancel: 'नाही, रद्द करा',
        sla: 'तुमची विनंती मिळाली आहे. आम्ही ती पूर्ण करत आहोत.',
        error: 'विनंती पाठवता आली नाही. पुन्हा प्रयत्न करा.',
    },
    export: {
        title: 'माझा डेटा निर्यात करा',
        intro: 'तुमच्या संमतीच्या आणि खात्याच्या नोंदींची प्रत तयार केली जाईल. आवाज आणि मजकुराच्या नोंदी अजून त्यात नाहीत.',
        submit: 'निर्यात तयार करा',
        sla: 'विनंती मिळाली. डाउनलोड लिंक अजून उपलब्ध नाही. arvesystems@gmail.com वर संपर्क करा, आम्ही तुम्हाला प्रत देऊ.',
        downloadLabel: 'डाउनलोड करा',
        error: 'विनंती पाठवता आली नाही. पुन्हा प्रयत्न करा.',
    },
    recent: {
        title: 'अलीकडील विनंत्या',
        empty: 'अद्याप कोणतीही विनंती नाही.',
        statusRequested: 'प्राप्त झाली',
        statusInProgress: 'चालू आहे',
        statusCompleted: 'पूर्ण',
        statusFailed: 'अयशस्वी',
    },
};

// -- en-IN --------------------------------------------------------------
const en: DataRightsBundle = {
    erasure: {
        title: 'Erase my data',
        intro: 'Request erasure of your account and personal details. This action cannot be undone.',
        confirmHeading: 'Are you sure?',
        confirmBody: 'Your account and personal details will be removed or anonymized. Farm records remain but will not be linked to your name. Some voice recordings stored on our servers cannot yet be deleted automatically.',
        submit: 'Yes, erase',
        cancel: 'No, cancel',
        sla: 'Request received. We are processing it.',
        error: 'Could not submit request. Please try again.',
    },
    export: {
        title: 'Export my data',
        intro: 'A copy of your consent and account records will be prepared. Voice and transcript records are not included yet.',
        submit: 'Generate export',
        sla: 'Request received. A download link is not available yet. Contact arvesystems@gmail.com and we will hand your copy over to you.',
        downloadLabel: 'Download',
        error: 'Could not submit request. Please try again.',
    },
    recent: {
        title: 'Recent requests',
        empty: 'No requests yet.',
        statusRequested: 'Received',
        statusInProgress: 'In progress',
        statusCompleted: 'Completed',
        statusFailed: 'Failed',
    },
};

export const DATA_RIGHTS_BUNDLES: Record<DataRightsLocale, DataRightsBundle> = {
    'mr-IN': mr,
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
