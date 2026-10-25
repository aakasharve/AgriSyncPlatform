// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//
// What one tick asserts, captured at the moment of the tap. Moved here from the deleted
// full-screen gate so the API, the link reconciler and the tick can share one shape
// without importing a screen.

import type { CoreDataCategoryCode, CorePurposeCode } from '../../../domain/consent/CoreConsentScope';
import {
    NOTICE_DATA_CATEGORY_CODES,
    NOTICE_PURPOSE_CODES,
    NOTICE_VERSION,
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
    canonicalNoticeText,
    type NoticeLanguage,
} from './consentNotice';

/** Everything the two legal records need, captured at the moment of the tap. */
export interface ConsentGateAcceptance {
    /** The language the notice was DISPLAYED in — not the account's preference. */
    displayedLanguage: NoticeLanguage;
    noticeVersion: string;
    termsVersion: string;
    privacyPolicyVersion: string;
    purposeCodes: readonly CorePurposeCode[];
    dataCategoryCodes: readonly CoreDataCategoryCode[];
    /** The exact notice text that was available to read — the thing that gets hashed. */
    canonicalNotice: string;
    ageDeclaredAdult: true;
}

/**
 * The acceptance for the notice as displayed in `language`. The tick's own sentence says
 * he is 18 or older, so `ageDeclaredAdult` is true by construction: there is no way to
 * tick it without declaring that.
 */
export function buildConsentAcceptance(language: NoticeLanguage): ConsentGateAcceptance {
    return {
        displayedLanguage: language,
        noticeVersion: NOTICE_VERSION,
        termsVersion: TERMS_VERSION,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        purposeCodes: NOTICE_PURPOSE_CODES,
        dataCategoryCodes: NOTICE_DATA_CATEGORY_CODES,
        canonicalNotice: canonicalNoticeText(language),
        ageDeclaredAdult: true,
    };
}
