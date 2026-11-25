// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half; design version 7) - the words of "कोणाची पद्धत फॉलो होते", one language at a time. The design's own
// sentences are used as written; every other Marathi phrase is PROPOSED (G:\agrisync-scratch\sched13\MARATHI-WORDS.md). No emoji, no machine date, no "AI" wording.
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';

export type TotalsLanguage = 'mr' | 'en';

export interface TotalsWords {
    open: string;
    title: string;
    rule: string;
    back: string;
    loading: string;
    /** The ONE sentence a missing number says, the same everywhere. */
    fewer: string;
    followingLine: (following: number, having: number | null) => string;
    havingOnly: (having: number) => string;
    followingLabel: string;
    worksTaken: (taken: number, inSchedule: number | null, percent: number | null) => string;
    worksTakenLabel: string;
    workLine: (name: string, farmers: number) => string;
    separate: string;
    doneLabel: string;
    done: (n: number) => string;
    heardLabel: string;
    heard: (n: number) => string;
    madeShramSafal: (source: string | null) => string;
    madeBy: (who: string) => string;
    sample: string;
    own: string;
    lastSeen: string;
    none: string;
    failed: string;
    libraryHeadline: (n: number) => string;
    ownTaken: (n: number) => string;
}

const mr = (n: number): string => toDevanagariDigits(n);

const MARATHI: TotalsWords = {
    open: 'कोणाची पद्धत किती फॉलो होते?',
    title: 'कोणाची पद्धत फॉलो होते',
    rule: 'फॉलो = शेतकऱ्याने ते काम स्वतःच्या शेड्यूलमध्ये घेतलं. "काम झालं" हे वेगळं मोजलं जातं.',
    back: 'मागे', // PROPOSED
    loading: 'आकडे पाहत आहोत…', // PROPOSED
    fewer: 'पाचपेक्षा कमी शेतकऱ्यांमागे असलेला आकडा दाखवला जात नाही.', // PROPOSED
    followingLine: (x, y) => (y !== null ? `${mr(x)} / ${mr(y)} शेतकरी फॉलो करतात` : `${mr(x)} शेतकरी फॉलो करतात`),
    havingOnly: y => `${mr(y)} शेतकऱ्यांच्या प्लॉटवर हे शेड्यूल लावलेलं आहे.`, // PROPOSED
    followingLabel: 'फॉलो करणारे शेतकरी: ', // PROPOSED
    worksTaken: (a, b, p) => `${mr(a)}${b !== null ? ` / ${mr(b)}` : ''} कामं घेतली${p !== null ? ` (${mr(p)}%)` : ''}`,
    worksTakenLabel: 'घेतलेली कामं: ', // PROPOSED
    workLine: (name, n) => `${name} — ${mr(n)} शेतकरी`,
    separate: 'वेगळं मोजलेलं (फॉलोमध्ये धरलेलं नाही)', // PROPOSED
    doneLabel: 'काम झालं म्हणून बंद झालेली कामं: ', // PROPOSED
    done: n => `काम झालं म्हणून बंद झालेली कामं: ${mr(n)}`, // PROPOSED
    heardLabel: 'मालकाचा संदेश ऐकलेले शेतकरी: ', // PROPOSED
    heard: n => `मालकाचा संदेश ऐकलेले शेतकरी: ${mr(n)}`, // PROPOSED
    madeShramSafal: src => (src ? `बनवणारे: श्रमसफल. स्रोत: ${src}. हे श्रेय ${src} च्या नावावर जात नाही.` : 'बनवणारे: श्रमसफल.'),
    madeBy: who => `बनवणारे: ${who}`, // PROPOSED
    sample: 'हे नमुना शेड्यूल आहे. नमुन्यासाठी आकडे नाहीत.', // PROPOSED
    own: 'हे तुमचं स्वतःचं शेड्यूल आहे. यासाठी एकूण आकडे नाहीत.', // PROPOSED
    lastSeen: 'हे आकडे इंटरनेट असताना शेवटी पाहिलेले आहेत.', // PROPOSED
    none: 'इंटरनेट नाही आणि फोनवर याआधीचे आकडे नाहीत. आकडे दाखवले जात नाहीत.', // PROPOSED
    failed: 'आकडे आत्ता मिळाले नाहीत. आकडे दाखवले जात नाहीत.', // PROPOSED
    libraryHeadline: n => `${mr(n)} शेतकरी फॉलो करतात`,
    ownTaken: n => `तुम्ही घेतलेली ${mr(n)} कामं`,
};

const ENGLISH: TotalsWords = {
    open: 'Whose method is followed how much?',
    title: 'Whose method is followed',
    rule: 'Follow = the farmer took that work into his own schedule. "Work done" is counted separately.',
    back: 'Back',
    loading: 'Looking up the numbers...',
    fewer: 'Fewer than five farmers stand behind this number, so it is not shown.',
    followingLine: (x, y) => (y !== null ? `${x} / ${y} farmers follow it` : `${x} farmers follow it`),
    havingOnly: y => `${y} farmers have this schedule on a plot.`,
    followingLabel: 'Farmers who follow it: ',
    worksTaken: (a, b, p) => `${a}${b !== null ? ` / ${b}` : ''} works taken${p !== null ? ` (${p}%)` : ''}`,
    worksTakenLabel: 'Works taken: ',
    workLine: (name, n) => `${name} — ${n} farmers`,
    separate: 'Counted separately (not part of following)',
    doneLabel: 'Jobs closed as done: ',
    done: n => `Jobs closed as done: ${n}`,
    heardLabel: 'Farmers who heard the owner\'s message: ',
    heard: n => `Farmers who heard the owner's message: ${n}`,
    madeShramSafal: src => (src ? `Made by: ShramSafal. Source: ${src}. This credit does not go to ${src}.` : 'Made by: ShramSafal.'),
    madeBy: who => `Made by: ${who}`,
    sample: 'This is a sample schedule. A sample has no numbers.',
    own: 'This is your own schedule. It has no totals.',
    lastSeen: 'These are the numbers last seen with internet.',
    none: 'No internet, and no earlier numbers on this phone. No numbers are shown.',
    failed: 'The numbers did not come just now. No numbers are shown.',
    libraryHeadline: n => `${n} farmers follow it`,
    ownTaken: n => `You have taken ${n} ${n === 1 ? 'work' : 'works'} from this schedule`,
};

export const totalsWords = (language: TotalsLanguage): TotalsWords => (language === 'en' ? ENGLISH : MARATHI);
