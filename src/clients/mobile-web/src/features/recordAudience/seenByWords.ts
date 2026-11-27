/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.3) - the words of the saved screen's read-only "हे दिसतं" line and
 * its "सेटिंग बदला" button. One language at a time. The seat words are the team card's (`teamModel.seatWord`, REUSED); the rest PROPOSED.
 */

export interface SeenByWords {
    line: (who: string) => string;
    money: (who: string) => string;
    only: (who: string) => string;
    holder: string;
    you: string;
    seat: Readonly<Record<string, string>>;
    otherSeat: string;
    change: string;
}

const mr: SeenByWords = {
    line: who => `हे दिसतं: ${who}`, // PROPOSED (Marathi) - founder 27 Nov playback
    money: who => ` · पैसे: ${who}`, // PROPOSED (Marathi) - contract §2.9
    only: who => `फक्त ${who}`, // PROPOSED (Marathi)
    holder: 'मालक', // REUSED - the role word
    you: 'तुम्ही', // PROPOSED (Marathi) - contract §2.9
    seat: { CoOwner: 'सहमालक', Family: 'कुटुंब', Mukadam: 'मुकादम', Worker: 'कामगार', SecondaryOwner: 'सहमालक / कुटुंब' }, // REUSED - seatWord; SecondaryOwner contract §3.3
    otherSeat: 'इतर सदस्य', // PROPOSED (Marathi) - a seat kind this phone does not know yet (never guessed)
    change: 'सेटिंग बदला', // the founder's own words (27 Nov)
};

const en: SeenByWords = {
    line: who => `Seen by: ${who}`, // PROPOSED (English)
    money: who => ` · Money: ${who}`, // PROPOSED (English)
    only: who => `${who} only`, // PROPOSED (English)
    holder: 'Owner', // PROPOSED (English)
    you: 'You', // PROPOSED (English)
    seat: { CoOwner: 'Co-owner', Family: 'Family', Mukadam: 'Mukadam', Worker: 'Worker', SecondaryOwner: 'Co-owner / Family' }, // PROPOSED (English)
    otherSeat: 'Another member', // PROPOSED (English)
    change: 'Change setting', // PROPOSED (English)
};

/** English only for 'en'; every other language reads Marathi. */
export const seenByWords = (language: string | null | undefined): SeenByWords => (language === 'en' ? en : mr);
