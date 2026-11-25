// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b) - every word of the owner's voice, Marathi OR English by the app's language (never both). Devanagari digits in
// Marathi. No emoji, no "AI" wording, no machine date. Every new Marathi word is PROPOSED for the founder's review (G:\agrisync-scratch\sched12b\MARATHI-WORDS.md).
import { mrNum } from '../schedulePage/scheduleCopy';
import type { OwnerDecision } from './ownerVoiceTypes';

export interface OwnerVoiceWords {
    listen: string;
    stop: string;
    voices: (n: number) => string;
    from: string;
    tipChip: string;
    changeChip: string;
    lookChip: string;
    notFetched: string;
    cannotPlay: string;
    before: string;
    now: string;
    changesNothing: string;
    accept: string;
    acceptTakeNew: string;
    keepOld: string;
    takeBack: string;
    standing: { accepted: string; kept_old: string; taken_back: string };
    queuedLine: (d: OwnerDecision) => string;
    answerQueuedLine: string;
    nowMissing: string;
    nowUnchecked: string;
    onlyOwnerDecides: string;
    youSaid: string;
    followUp: string;
    jobClip: string;
}

const MR: OwnerVoiceWords = {
    listen: 'ऐका',
    stop: 'थांबवा',
    voices: n => `${mrNum(n)} आवाज`,
    from: 'शेड्यूल बनवणाऱ्याचा',
    tipChip: 'आवाजातली टीप',
    changeChip: 'बदल',
    lookChip: 'बघा आणि सांगा',
    notFetched: 'हा आवाज अजून फोनवर आलेला नाही. नेट आल्यावर तो इथे येईल.',
    cannotPlay: 'हा आवाज वाजवता आला नाही.',
    before: 'आधी',
    now: 'आता',
    changesNothing: 'हा बदल तुम्ही ठरवेपर्यंत तुमचं वेळापत्रक आणि कामं जशीच्या तशी राहतात.',
    accept: 'बदल स्वीकारा',
    acceptTakeNew: 'नवं माझ्या वेळापत्रकात घ्या',
    keepOld: 'जुनंच ठेवा',
    takeBack: 'बदल परत घ्या',
    standing: { accepted: 'तुम्ही बदल स्वीकारला', kept_old: 'तुम्ही जुनंच ठेवलं', taken_back: 'तुम्ही बदल परत घेतला' },
    queuedLine: d => `${{ accept: 'बदल स्वीकारणार', keep_old: 'जुनंच ठेवणार', take_back: 'बदल परत घेणार' }[d]} — फोनवर ठेवलं, नेट आल्यावर पाठवलं जाईल`,
    answerQueuedLine: 'तुमचं उत्तर फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल',
    nowMissing: 'नवी आवृत्ती अजून फोनवर आलेली नाही. ती आल्यावर इथे स्वीकारता येईल.',
    nowUnchecked: 'ही नवी आवृत्ती अजून तपासलेली नाही, म्हणून ती स्वीकारता येत नाही.',
    onlyOwnerDecides: 'हा बदल स्वीकारायचा की नाही ते शेड्यूल पाळणारे मालक ठरवतात.',
    youSaid: 'तुम्ही सांगितलं',
    followUp: 'त्यांचं पुढचं बोलणं',
    jobClip: 'या कामासाठी शेड्यूल बनवणाऱ्याचा आवाज',
};

const EN: OwnerVoiceWords = {
    listen: 'Listen',
    stop: 'Stop',
    voices: n => `${n} voice${n === 1 ? '' : 's'}`,
    from: 'From the schedule maker',
    tipChip: 'Tip in voice',
    changeChip: 'Change',
    lookChip: 'Look and tell',
    notFetched: 'This voice is not on your phone yet. It will come when you have signal.',
    cannotPlay: 'This voice could not be played.',
    before: 'Before',
    now: 'Now',
    changesNothing: 'Your schedule and your jobs stay exactly as they are until you decide.',
    accept: 'Accept the change',
    acceptTakeNew: 'Take the new one into my schedule',
    keepOld: 'Keep the old one',
    takeBack: 'Take the change back',
    standing: { accepted: 'You accepted the change', kept_old: 'You kept the old one', taken_back: 'You took the change back' },
    queuedLine: d => `${{ accept: 'Will accept the change', keep_old: 'Will keep the old one', take_back: 'Will take the change back' }[d]} - kept on this phone, will be sent when you have signal`,
    answerQueuedLine: 'Your answer is kept on this phone - it will be sent when you have signal',
    nowMissing: 'The new version is not on your phone yet. You can accept here once it arrives.',
    nowUnchecked: 'This new version has not been checked yet, so it cannot be accepted.',
    onlyOwnerDecides: 'Whether to accept this change is for the owner who follows the schedule.',
    youSaid: 'You said',
    followUp: 'Their next words',
    jobClip: 'The schedule maker\'s voice for this job',
};

export const ownerVoiceWords = (language: 'mr' | 'en'): OwnerVoiceWords => (language === 'en' ? EN : MR);
