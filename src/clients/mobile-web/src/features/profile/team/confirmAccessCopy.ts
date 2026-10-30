/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — the words of the co-owner's CONFIRMING switch on the
 * team screen (founder D-44 §2: "The primary owner may confirm personally or explicitly delegate this
 * responsibility to a family member, trusted मुकादम or another selected member. Being appointed मुकादम or co-owner
 * must not automatically grant this authority."). One language at a time: Marathi mode shows only Marathi,
 * English mode only English. Every line is new wording for this switch, awaiting the founder.
 */

export interface ConfirmAccessCopy {
    /** The switch is ON: he confirms records on the owner's behalf. */
    on: string;
    /** The switch is OFF: the door to give it. */
    off: string;
    /** One line under the switch: what it does, and that it is the primary owner's to give. */
    hint: string;
}

const mr: ConfirmAccessCopy = {
    on: 'नोंदी पक्क्या करण्याची जबाबदारी आहे', // PROPOSED (Marathi)
    off: 'नोंदी पक्क्या करण्याची जबाबदारी द्या', // PROPOSED (Marathi)
    hint: 'तुम्ही दिलीत तरच हे सहमालक नोंदी पक्क्या करू शकतात.', // PROPOSED (Marathi)
};

const en: ConfirmAccessCopy = {
    on: 'Responsible for confirming records', // PROPOSED (English)
    off: 'Give the responsibility to confirm records', // PROPOSED (English)
    hint: 'This co-owner can confirm records only if you give this.', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function confirmAccessCopy(language: string | null | undefined): ConfirmAccessCopy {
    return language === 'en' ? en : mr;
}
