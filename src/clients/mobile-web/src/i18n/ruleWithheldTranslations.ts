/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 fix 1 (FIX-1 item 16) — the founder's words for EVERYTHING held back by the money rule. A "not shown to
 * you" line reads as a personal denial; every place where money, wages, words or voice are held back reads as a fixed
 * ShramSafal rule instead: never "to you", never pointing at the owner, never saying the owner cannot change it (he
 * can, with पैसे पाहणे). The founder's own words, Marathi and English twins; one language at a time (Marathi mode shows
 * only Marathi, English mode only English). Every screen reads them from here, so the three lines cannot drift.
 *
 * The removed-seat line ("या शेतावर आता तुमची नोंद घेतली जात नाही. मालकाशी बोला.") is NOT one of these and stays where it is.
 */

export interface RuleWithheldCopy {
    /** W1 — the record card of a record that mentions money, in place of its words and voice (D-66). */
    recordWords: string;
    /** W2 — a money page, and the hidden पैसे व हिशोब. */
    moneyAccounts: string;
    /** W3 — in place of an amount or a wage (a cell where ₹ would be: job cards, labour, the worker page). */
    amount: string;
    /**
     * W4 (lane PRV, founder D-26 — orchestrator call 8) — under a total that leaves out a record whose audience leaves
     * this person out. The founder's rule of 2026-11-01: ShramSafal's rule, never "not shown to you", never the owner.
     */
    notCounted: string;
}

const mr: RuleWithheldCopy = {
    // Founder 2026-11-01 (FIX-1 item 16, W1), verbatim.
    recordWords: 'श्रमसफलच्या नियमानुसार पैशांचा उल्लेख असलेल्या नोंदीचे शब्द व आवाज इथे दिसत नाहीत. कामाची माहिती खाली आहे.',
    // Founder 2026-11-01 (W2), verbatim.
    moneyAccounts: 'श्रमसफलच्या नियमानुसार पैशांचा हिशोब इथे दिसत नाही.',
    // Founder 2026-11-01 (W3), verbatim.
    amount: 'नियमानुसार दिसत नाही',
    // Orchestrator 2026-11-01 (W4), verbatim.
    notCounted: 'श्रमसफलच्या नियमानुसार काही नोंदी या हिशोबात धरलेल्या नाहीत.',
};

const en: RuleWithheldCopy = {
    // Founder 2026-11-01 (W1), verbatim.
    recordWords: "By ShramSafal's rules, the words and voice of a record that mentions money are not shown here. The work details are below.",
    // Founder 2026-11-01 (W2), verbatim.
    moneyAccounts: "By ShramSafal's rules, the money accounts are not shown here.",
    // Founder 2026-11-01 (W3), verbatim.
    amount: 'Not shown by rule',
    // Orchestrator 2026-11-01 (W4), verbatim.
    notCounted: "By ShramSafal's rules, some records are not counted here.",
};

/** English only for 'en'; every other language reads Marathi (the app's default). */
export function ruleWithheldCopy(language: string | null | undefined): RuleWithheldCopy {
    return language === 'en' ? en : mr;
}
