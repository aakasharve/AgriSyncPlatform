// spec: data-principle-spine-2026-05-05/10.4
//
// PII review queue admin surface — i18n bundle. Three locales
// (mr-IN, hi-IN, en-IN). Per Phase 06 OQ-7 verdict (now binding via
// DS-015 Track-B) every value is tagged with the
// `[LEGAL_REVIEW_PENDING] ` marker via `tagLegalString(...)` until
// counsel signs off on the final copy.
//
// Shape mirrors consentTranslations.ts — keep the surface predictable
// so the legal-review-gate CI workflow can reason about both bundles
// uniformly.

import { tagLegalString } from './legalReviewMarker';

/** Locale codes accepted by the PII review feature. */
export type PiiReviewLocale = 'mr-IN' | 'hi-IN' | 'en-IN';

/**
 * Map the base app's `Language` ('en' | 'mr') onto PII review locales.
 * Hindi is reachable when callers route it manually (future language
 * picker). Unknown maps to en-IN.
 */
export function toPiiReviewLocale(lang: string | null | undefined): PiiReviewLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    if (lang === 'hi' || lang === 'hi-IN') return 'hi-IN';
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
// LEGAL_REVIEW_PENDING: all values below — Marathi, awaiting counsel.
const mr: PiiReviewBundle = {
    queue: {
        title: tagLegalString('गोपनीयता परीक्षण रांग'),
        empty: tagLegalString('कोणतीही परीक्षण-प्रलंबित नोंद नाही.'),
        loading: tagLegalString('रांग लोड होत आहे…'),
        loadError: tagLegalString('रांग आणता आली नाही. पुन्हा प्रयत्न करा.'),
        statusPending: tagLegalString('परीक्षण बाकी'),
        statusAutoRedacted: tagLegalString('स्वयं-रिडॅक्ट केले'),
        statusReviewApproved: tagLegalString('मंजूर'),
        statusReviewRejected: tagLegalString('नाकारले'),
        statusDiscarded: tagLegalString('टाकून दिले'),
        listColumns: {
            transcriptId: tagLegalString('प्रतिलेख आयडी'),
            score: tagLegalString('स्कोर'),
            occurredAtUtc: tagLegalString('वेळ (UTC)'),
            action: tagLegalString('कृती'),
        },
    },
    decision: {
        title: tagLegalString('रिडॅक्शन परीक्षण'),
        originalLabel: tagLegalString('मूळ मजकूर'),
        redactedLabel: tagLegalString('रिडॅक्ट केलेला मजकूर'),
        notePlaceholder: tagLegalString('परीक्षकाची टिप्पणी (पर्यायी)'),
        approveButton: tagLegalString('मंजूर करा'),
        rejectButton: tagLegalString('नाकारा'),
        approveSuccess: tagLegalString('मंजुरी जतन झाली.'),
        rejectSuccess: tagLegalString('नाकारणी जतन झाली.'),
        approveError: tagLegalString('मंजूर करता आले नाही. पुन्हा प्रयत्न करा.'),
        rejectError: tagLegalString('नाकारता आले नाही. पुन्हा प्रयत्न करा.'),
        backToQueue: tagLegalString('रांगेवर परत'),
    },
};

// -- hi-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Hindi, awaiting counsel.
const hi: PiiReviewBundle = {
    queue: {
        title: tagLegalString('गोपनीयता समीक्षा क़तार'),
        empty: tagLegalString('कोई समीक्षा-लंबित प्रविष्टि नहीं।'),
        loading: tagLegalString('क़तार लोड हो रही है…'),
        loadError: tagLegalString('क़तार लोड नहीं हो सकी। फिर से कोशिश करें।'),
        statusPending: tagLegalString('समीक्षा शेष'),
        statusAutoRedacted: tagLegalString('स्वतः-रिडैक्ट'),
        statusReviewApproved: tagLegalString('स्वीकृत'),
        statusReviewRejected: tagLegalString('अस्वीकृत'),
        statusDiscarded: tagLegalString('त्यागी गई'),
        listColumns: {
            transcriptId: tagLegalString('प्रतिलेख आईडी'),
            score: tagLegalString('स्कोर'),
            occurredAtUtc: tagLegalString('समय (UTC)'),
            action: tagLegalString('कार्रवाई'),
        },
    },
    decision: {
        title: tagLegalString('रिडैक्शन समीक्षा'),
        originalLabel: tagLegalString('मूल पाठ'),
        redactedLabel: tagLegalString('रिडैक्टेड पाठ'),
        notePlaceholder: tagLegalString('समीक्षक की टिप्पणी (वैकल्पिक)'),
        approveButton: tagLegalString('स्वीकृत करें'),
        rejectButton: tagLegalString('अस्वीकृत करें'),
        approveSuccess: tagLegalString('स्वीकृति सहेज ली गई।'),
        rejectSuccess: tagLegalString('अस्वीकृति सहेज ली गई।'),
        approveError: tagLegalString('स्वीकृत नहीं किया जा सका। पुनः प्रयास करें।'),
        rejectError: tagLegalString('अस्वीकृत नहीं किया जा सका। पुनः प्रयास करें।'),
        backToQueue: tagLegalString('क़तार पर वापस'),
    },
};

// -- en-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — English, awaiting counsel.
const en: PiiReviewBundle = {
    queue: {
        title: tagLegalString('PII Review Queue'),
        empty: tagLegalString('No review-pending entries.'),
        loading: tagLegalString('Loading queue…'),
        loadError: tagLegalString('Could not load the queue. Please try again.'),
        statusPending: tagLegalString('Pending'),
        statusAutoRedacted: tagLegalString('Auto-redacted'),
        statusReviewApproved: tagLegalString('Approved'),
        statusReviewRejected: tagLegalString('Rejected'),
        statusDiscarded: tagLegalString('Discarded'),
        listColumns: {
            transcriptId: tagLegalString('Transcript ID'),
            score: tagLegalString('Score'),
            occurredAtUtc: tagLegalString('Time (UTC)'),
            action: tagLegalString('Action'),
        },
    },
    decision: {
        title: tagLegalString('Redaction review'),
        originalLabel: tagLegalString('Original text'),
        redactedLabel: tagLegalString('Redacted text'),
        notePlaceholder: tagLegalString('Reviewer note (optional)'),
        approveButton: tagLegalString('Approve'),
        rejectButton: tagLegalString('Reject'),
        approveSuccess: tagLegalString('Approval saved.'),
        rejectSuccess: tagLegalString('Rejection saved.'),
        approveError: tagLegalString('Could not approve. Please try again.'),
        rejectError: tagLegalString('Could not reject. Please try again.'),
        backToQueue: tagLegalString('Back to queue'),
    },
};

export const PII_REVIEW_BUNDLES: Record<PiiReviewLocale, PiiReviewBundle> = {
    'mr-IN': mr,
    'hi-IN': hi,
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
