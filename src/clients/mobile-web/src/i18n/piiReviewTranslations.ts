// spec: data-principle-spine-2026-05-05/10.4
//
// PII review queue admin surface — i18n bundle. Three locales
// (mr-IN, en-IN). Strings render exactly as written: no visible review
// prefix is added at runtime. Copy review status is tracked in the private
// review records.
//
// Shape mirrors consentTranslations.ts.

/** Locale codes accepted by the PII review feature. */
export type PiiReviewLocale = 'mr-IN' | 'en-IN';

/**
 * Map the base app's `Language` ('en' | 'mr') onto PII review locales.
 * Hindi is reachable when callers route it manually (future language
 * picker). Unknown maps to en-IN.
 */
export function toPiiReviewLocale(lang: string | null | undefined): PiiReviewLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    // Hindi is not offered. A stored or server-sent 'hi' falls back to Marathi,
    // the app default (same rule as LanguageContext / LanguageSyncFromServer).
    if (lang === 'hi' || lang === 'hi-IN') return 'mr-IN';
    return 'en-IN';
}

export interface PiiReviewBundle {
    queue: {
        title: string;
        empty: string;
        loading: string;
        loadError: string;
        statusPending: string;
        statusAutoRedacted: string;
        statusReviewApproved: string;
        statusReviewRejected: string;
        statusDiscarded: string;
        listColumns: {
            transcriptId: string;
            score: string;
            occurredAtUtc: string;
            action: string;
        };
    };
    decision: {
        title: string;
        originalLabel: string;
        redactedLabel: string;
        notePlaceholder: string;
        approveButton: string;
        rejectButton: string;
        approveSuccess: string;
        rejectSuccess: string;
        approveError: string;
        rejectError: string;
        backToQueue: string;
    };
}

// -- mr-IN --------------------------------------------------------------
const mr: PiiReviewBundle = {
    queue: {
        title: 'गोपनीयता परीक्षण रांग',
        empty: 'कोणतीही परीक्षण-प्रलंबित नोंद नाही.',
        loading: 'रांग लोड होत आहे…',
        loadError: 'रांग आणता आली नाही. पुन्हा प्रयत्न करा.',
        statusPending: 'परीक्षण बाकी',
        statusAutoRedacted: 'स्वयं-रिडॅक्ट केले',
        statusReviewApproved: 'मंजूर',
        statusReviewRejected: 'नाकारले',
        statusDiscarded: 'टाकून दिले',
        listColumns: {
            transcriptId: 'प्रतिलेख आयडी',
            score: 'स्कोर',
            occurredAtUtc: 'वेळ (UTC)',
            action: 'कृती',
        },
    },
    decision: {
        title: 'रिडॅक्शन परीक्षण',
        originalLabel: 'मूळ मजकूर',
        redactedLabel: 'रिडॅक्ट केलेला मजकूर',
        notePlaceholder: 'परीक्षकाची टिप्पणी (पर्यायी)',
        approveButton: 'मंजूर करा',
        rejectButton: 'नाकारा',
        approveSuccess: 'मंजुरी जतन झाली.',
        rejectSuccess: 'नाकारणी जतन झाली.',
        approveError: 'मंजूर करता आले नाही. पुन्हा प्रयत्न करा.',
        rejectError: 'नाकारता आले नाही. पुन्हा प्रयत्न करा.',
        backToQueue: 'रांगेवर परत',
    },
};

// -- en-IN --------------------------------------------------------------
const en: PiiReviewBundle = {
    queue: {
        title: 'PII Review Queue',
        empty: 'No review-pending entries.',
        loading: 'Loading queue…',
        loadError: 'Could not load the queue. Please try again.',
        statusPending: 'Pending',
        statusAutoRedacted: 'Auto-redacted',
        statusReviewApproved: 'Approved',
        statusReviewRejected: 'Rejected',
        statusDiscarded: 'Discarded',
        listColumns: {
            transcriptId: 'Transcript ID',
            score: 'Score',
            occurredAtUtc: 'Time (UTC)',
            action: 'Action',
        },
    },
    decision: {
        title: 'Redaction review',
        originalLabel: 'Original text',
        redactedLabel: 'Redacted text',
        notePlaceholder: 'Reviewer note (optional)',
        approveButton: 'Approve',
        rejectButton: 'Reject',
        approveSuccess: 'Approval saved.',
        rejectSuccess: 'Rejection saved.',
        approveError: 'Could not approve. Please try again.',
        rejectError: 'Could not reject. Please try again.',
        backToQueue: 'Back to queue',
    },
};

export const PII_REVIEW_BUNDLES: Record<PiiReviewLocale, PiiReviewBundle> = {
    'mr-IN': mr,
    'en-IN': en,
};

/**
 * Look up a PII review string by dot-path. Defensive: returns the
 * key itself if the path is missing (mirrors the consent t() helper).
 */
export function tPiiReview(locale: PiiReviewLocale, key: string): string {
    const parts = key.split('.');
    let cur: unknown = PII_REVIEW_BUNDLES[locale];
    for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
            cur = (cur as Record<string, unknown>)[p];
        } else {
            return key;
        }
    }
    return typeof cur === 'string' ? cur : key;
}
