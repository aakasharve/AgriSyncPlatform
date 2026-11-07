/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the words and number shapes the पैसे व हिशोब
 * pages share, taken from the founder-approved preview (PLR-D9 `app/moneyData.ts`): the page names, the
 * eight kinds of cost, where an entry stands (नोंदवलेले / तपासायचे / मंजूर / दुरुस्त केलेले), the four
 * report periods (and their calendar days) and ₹ the Indian way. Words, dates and formatting ONLY — no
 * sample entries, rates or figures.
 */
import type { AppRoute } from '../../types';
import { DISPLAY_TIME_ZONE } from '../../shared/utils/displayTime';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import type { FinanceFilters, FinancePipelineBucket, MoneyCategory, MoneyEvent, MoneySourceType } from './finance.types';

/** ₹ the Indian way: `₹ 1,30,200`. Whole rupees, as every money page has always shown them. */
export const rupees = (n: number): string => `₹ ${Math.round(n).toLocaleString('en-IN')}`;

/** The six finance routes and the one name each goes by — on its title bar, its row and its chip. */
export const FINANCE_TITLE = {
    'finance-manager': 'पैसे व हिशोब',
    'finance-ledger': 'वही',
    'finance-price-book': 'दरपत्रक',
    'finance-review-inbox': 'तपासायचे',
    'finance-reports': 'अहवाल',
} as const satisfies Partial<Record<AppRoute, string>>;

export type FinanceRoute = keyof typeof FINANCE_TITLE;

/** In the order the price book has always listed them. */
export const MONEY_CATEGORIES: readonly MoneyCategory[] = ['Labour', 'Input', 'Machinery', 'Transport', 'Repair', 'Fuel', 'Electricity', 'Other'];

export const CATEGORY_LABEL: Record<MoneyCategory, string> = {
    Labour: 'मजुरी', Input: 'खत-औषध', Machinery: 'यंत्र', Transport: 'वाहतूक',
    Repair: 'दुरुस्ती', Fuel: 'इंधन', Electricity: 'वीज', Other: 'इतर',
};

/** A category arrives as a typed union, but the correction sheet takes a plain string; anything unknown reads इतर. */
export const categoryLabel = (category: string): string => CATEGORY_LABEL[category as MoneyCategory] ?? CATEGORY_LABEL.Other;

/**
 * Where an entry came from. `Manual` is left blank on purpose: every entry read back from the server comes
 * back as `Manual` (financeService `mapCostEntryToMoneyEvent`), including ones that were spoken, so naming
 * it "हातानं लिहिलेली" would be a claim nobody made.
 */
export const SOURCE_LABEL: Record<MoneySourceType, string> = {
    Manual: '', VoiceLog: 'बोलून सांगितलेली', Procurement: 'खरेदी', Income: 'उत्पन्न', ScheduleAuto: 'वेळापत्रकातून', Adjustment: 'दुरुस्ती',
};

/** The four piles on the पैसे व हिशोब home (`financeSelectors.getPipelineBuckets`). */
export const BUCKET_LABEL: Record<FinancePipelineBucket['key'], string> = {
    Captured: 'नोंदवलेले', NeedsReview: 'तपासायचे', Approved: 'मंजूर', Adjusted: 'दुरुस्त केलेले',
};

/** One entry's standing, in the same four words: waiting to be looked at first, then corrected, approved, recorded. */
export function entryState(e: Pick<MoneyEvent, 'reviewStatus' | 'trustStatus'>): FinancePipelineBucket['key'] {
    if (e.reviewStatus === 'NeedsReview') return 'NeedsReview';
    if (e.trustStatus === 'Adjusted') return 'Adjusted';
    if (e.trustStatus === 'Verified') return 'Approved';
    return 'Captured';
}

export type ReportPeriod = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'ALL_TIME';
export const PERIOD_LABEL: Record<ReportPeriod, string> = {
    THIS_MONTH: 'हा महिना', LAST_MONTH: 'मागचा महिना', THIS_YEAR: 'हे वर्ष', ALL_TIME: 'सगळं',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * A report period's first and last calendar day as `YYYY-MM-DD` keys on the farm's calendar (IST, via
 * `getDateKey`) — the keys `financeSelectors` compares entry days against. Built from local midnight through
 * `toISOString()` (as the English page did), the bounds land on the previous day in India.
 */
export function periodFilters(period: ReportPeriod, todayKey: string = getDateKey()): FinanceFilters {
    const [year, month] = todayKey.split('-').map(Number);
    switch (period) {
        case 'THIS_MONTH': return { fromDate: `${year}-${pad2(month)}-01` };
        case 'LAST_MONTH': {
            const y = month === 1 ? year - 1 : year;
            const m = month === 1 ? 12 : month - 1;
            const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
            return { fromDate: `${y}-${pad2(m)}-01`, toDate: `${y}-${pad2(m)}-${pad2(lastDay)}` };
        }
        case 'THIS_YEAR': return { fromDate: `${year}-01-01` };
        default: return {};
    }
}

/**
 * Why the server set an entry aside, in plain Marathi. The server writes these in English
 * (`High amount: >= 25000 INR`); the amount in it is read out, never invented. A reason this page does not
 * know is not shown in English — it says the entry looked different, which is all the farmer can act on.
 */
export function reviewReasonLabel(reason: string): string {
    if (/high[\s_-]*amount/i.test(reason)) {
        const n = /(\d[\d,]*)/.exec(reason);
        return n ? `${rupees(Number(n[1].replace(/,/g, '')))} किंवा जास्त रक्कम` : 'मोठी रक्कम';
    }
    if (/duplicate/i.test(reason)) return 'दुहेरी नोंद असू शकते';
    // lane BILL-1 fix round 1 (review M3) — approved before, changed since: looked at again. PROPOSED.
    if (/changed after approval/i.test(reason)) return 'मंजुरीनंतर बदललं — पुन्हा पाहा';
    return 'वेगळी दिसली — एकदा पाहा';
}

/** `1 नोंद`, `3 नोंदी`. */
export const entriesCount = (n: number): string => `${n} ${n === 1 ? 'नोंद' : 'नोंदी'}`;

/**
 * A `YYYY-MM-DD` day as `रविवार, 25 ऑक्टो` (Latin digits, as everywhere else in the app). The key is a
 * calendar day, so it is read and written in UTC — no clock shift can move it to the next day.
 */
export function formatDayKey(dateKey: string, withWeekday = true): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!m) return dateKey;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return withWeekday
        ? new Intl.DateTimeFormat('mr-IN-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d)
        : new Intl.DateTimeFormat('mr-IN-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/**
 * An entry's or a rate's date as `25 ऑक्टो 2026`: a plain `YYYY-MM-DD` key as written, an instant on the
 * farm's clock (IST, `DISPLAY_TIME_ZONE`). Nothing when it cannot be read — never a made-up date.
 */
export function formatMoneyDate(value: string | undefined): string {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDayKey(value, false);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('mr-IN-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DISPLAY_TIME_ZONE }).format(d);
}
