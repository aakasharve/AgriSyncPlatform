/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1. The words of the one-time new-phone question, ONE
 * language at a time (PLR-D9 T1/T2; English only for someone who chose English).
 *
 * The question and its two answers are the founder's own (D-56, PENDING-DECISIONS 2026-11-06). The "नाही" sentence is
 * the CTO call D-85's PROPOSED wording. Every other Marathi word here is marked `// PROPOSED (Marathi)`; all English is
 * PROPOSED. No emoji, no "AI".
 */
import type { Language } from '../../../i18n/language';

export interface DeviceCheckCopy {
    /** "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?" */
    question: (accountName: string) => string;
    yes: string;
    no: string;
    /** Shown after "नाही": this phone does not open the account. */
    declined: string;
    back: string;
    sending: string;
    /** The answer did not reach the server (no signal, or the server did not answer). */
    failed: string;
}

const MR: DeviceCheckCopy = {
    question: (name) => `हे खातं ${name} यांचं आहे — तुम्ही तेच आहात का?`, // founder D-56
    yes: 'होय', // founder D-56
    no: 'नाही', // founder D-56
    declined: 'हे खातं तुमचं नाही. नंबर बदलला असेल तर श्रमसफल मदतीशी संपर्क करा.', // PROPOSED (Marathi) — CTO call D-85
    back: 'मागे', // the login screens' existing word (authCopy.back)
    sending: 'पाठवत आहे…', // PROPOSED (Marathi)
    failed: 'उत्तर पोहोचलं नाही. पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
};

const EN: DeviceCheckCopy = {
    question: (name) => `This account belongs to ${name} — is that you?`, // PROPOSED
    yes: 'Yes', // PROPOSED
    no: 'No', // PROPOSED
    declined: 'This account is not yours. If your number changed hands, contact ShramSafal help.', // PROPOSED
    back: 'Back',
    sending: 'Sending…', // PROPOSED
    failed: 'Your answer did not reach us. Try again.', // PROPOSED
};

export const deviceCheckCopy = (language: Language | null | undefined): DeviceCheckCopy => (language === 'en' ? EN : MR);
