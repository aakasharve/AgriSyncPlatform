// spec: data-principle-spine-2026-05-05/08.6
//
// Data rights namespace i18n bundle. Two locales (mr-IN,
// en-IN) per DPDP §5. Strings render exactly as written: no visible review
// prefix is added at runtime. Copy review status is tracked in the private
// review records.
//
// Timing wording must describe what the system actually does. The export worker
// cannot currently issue a download link (ExportWorker.NoSignerReason), so that
// screen states no number of hours.
//
// spec: plr-d10 lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02) — an erasure request
// WAITS 30 days (the server's ErasureTiming, 30 by default) and can be cancelled until then;
// only after the 30 days does the worker erase anything. Every erasure line below says so.
// The 30 is the founder's number; the date shown is the one the server sends
// (erasureStartsAtUtc), never one the phone works out. All new or changed words: PROPOSED.

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
        /** D-71: the 30-day wait and the cancel, said before he asks. */
        wait: string;
        confirmHeading: string;
        confirmBody: string;
        submit: string;
        cancel: string;
        /** After the request, when the server sent no date (an older server). */
        sla: string;
        /** After the request: `{date}` is the server's erasureStartsAtUtc. */
        slaWithDate: string;
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
        /** A waiting erasure request: `{date}` is when erasure starts. */
        statusWaiting: string;
        statusInProgress: string;
        statusCompleted: string;
        statusCompletedWithResidue: string;
        statusFailed: string;
        statusCancelled: string;
        kindErasure: string;
        kindExport: string;
        askedOnBehalf: string;
        cancelAction: string;
        cancelDone: string;
        cancelStarted: string;
        cancelError: string;
        loadError: string;
    };
}

// -- mr-IN --------------------------------------------------------------
const mr: DataRightsBundle = {
    erasure: {
        title: 'माझा डेटा मिटवा',
        intro: 'तुमचे खाते आणि वैयक्तिक माहिती मिटवण्याची विनंती. एकदा मिटवलेली माहिती परत आणता येणार नाही.',
        wait: 'विनंती केल्यानंतर ३० दिवस काहीही मिटवले जात नाही. या ३० दिवसांत तुम्ही विनंती रद्द करू शकता. ३० दिवसांनंतरच मिटवणे सुरू होते.',
        confirmHeading: 'खात्री आहे का?',
        confirmBody: 'तुमचे खाते आणि वैयक्तिक माहिती काढली किंवा अनामिक केली जाईल. शेतीचे रेकॉर्ड शिल्लक राहतील पण तुमचे नाव त्यांच्याशी जोडले जाणार नाही. सर्व्हरवर साठवलेले काही आवाज अजून आपोआप मिटवता येत नाहीत. विनंतीनंतर ३० दिवसांनी मिटवणे सुरू होईल; तोपर्यंत तुम्ही ती रद्द करू शकता.',
        submit: 'हो, मिटवा',
        cancel: 'नाही, रद्द करा',
        sla: 'तुमची विनंती मिळाली आहे. ३० दिवसांनी मिटवणे सुरू होईल; तोपर्यंत तुम्ही ती रद्द करू शकता.',
        slaWithDate: 'तुमची विनंती मिळाली आहे. {date} रोजी मिटवणे सुरू होईल. तोपर्यंत खालील यादीतून तुम्ही ती रद्द करू शकता.',
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
        statusWaiting: 'थांबलेली — {date} रोजी मिटवणे सुरू होईल',
        statusInProgress: 'चालू आहे',
        statusCompleted: 'पूर्ण',
        statusCompletedWithResidue: 'मिटवली — काही आवाज-फाइली अजून काढायच्या आहेत',
        statusFailed: 'अयशस्वी',
        statusCancelled: 'रद्द केली — काहीही मिटवले नाही',
        kindErasure: 'माहिती मिटवणे',
        kindExport: 'माहितीची प्रत',
        askedOnBehalf: 'श्रमसफलने तुमच्या वतीने केलेली विनंती',
        cancelAction: 'विनंती रद्द करा',
        cancelDone: 'विनंती रद्द केली. काहीही मिटवले नाही.',
        cancelStarted: 'मिटवणे सुरू झाले आहे, त्यामुळे आता रद्द करता येणार नाही.',
        cancelError: 'रद्द करता आले नाही. पुन्हा प्रयत्न करा.',
        loadError: 'तुमच्या विनंत्या आणता आल्या नाहीत.',
    },
};

// -- en-IN --------------------------------------------------------------
const en: DataRightsBundle = {
    erasure: {
        title: 'Erase my data',
        intro: 'Request erasure of your account and personal details. Once erased, it cannot be brought back.',
        wait: 'After you ask, nothing is erased for 30 days. You can cancel the request during those 30 days. Erasure starts only after 30 days.',
        confirmHeading: 'Are you sure?',
        confirmBody: 'Your account and personal details will be removed or anonymized. Farm records remain but will not be linked to your name. Some voice recordings stored on our servers cannot yet be deleted automatically. Erasure starts 30 days after your request; until then you can cancel it.',
        submit: 'Yes, erase',
        cancel: 'No, cancel',
        sla: 'Request received. Erasure starts in 30 days; until then you can cancel it.',
        slaWithDate: 'Request received. Erasure starts on {date}. Until then you can cancel it from the list below.',
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
        statusWaiting: 'Waiting — erasure starts on {date}',
        statusInProgress: 'In progress',
        statusCompleted: 'Completed',
        statusCompletedWithResidue: 'Erased — some voice files are still to be removed',
        statusFailed: 'Failed',
        statusCancelled: 'Cancelled — nothing was erased',
        kindErasure: 'Erase my data',
        kindExport: 'Copy of my data',
        askedOnBehalf: 'Asked on your behalf by ShramSafal',
        cancelAction: 'Cancel request',
        cancelDone: 'Request cancelled. Nothing was erased.',
        cancelStarted: 'Erasure has already started, so it can no longer be cancelled.',
        cancelError: 'Could not cancel. Please try again.',
        loadError: 'Could not load your requests.',
    },
};

export const DATA_RIGHTS_BUNDLES: Record<DataRightsLocale, DataRightsBundle> = {
    'mr-IN': mr,
    'en-IN': en,
};

/**
 * lane F99 fix pass 1 (D-71) — a server date (ISO, UTC) as a day the person reads in his language:
 * "२ डिसेंबर, २०२६" / "2 December 2026". An unreadable value gives "" (never a made-up date).
 */
export function formatDataRightsDate(locale: DataRightsLocale, iso: string | null | undefined): string {
    if (!iso) return '';
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return '';
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(when);
}

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
