// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, PLR-D9 T1-T3; P4) — the offline-notes page's
// words: plain Marathi, the right noun for each kind of note, and a date that is never invented.
import { describe, expect, it } from 'vitest';
import type { UnreviewedAiResult } from '../../infrastructure/sync/PendingAiResultsReader';
import { DRAFTS_TITLE, discardConfirmMessage, formatRecordedAt, previewLabel, savedWithWarningMessage } from '../aiDraftsCopy';
import { OFFLINE_NOTES_TITLE } from '../../features/profile/settingsItems';

const job = (operationType: string, payload: unknown = {}, textTranscript?: string) => ({
    id: 1, operationType, context: { textTranscript }, result: { operationType, payload },
}) as unknown as UnreviewedAiResult;

describe('offline-notes page words', () => {
    it('the page and its setup-hub row carry one name, and it is not a voice-only name', () => {
        expect(DRAFTS_TITLE).toBe(OFFLINE_NOTES_TITLE);
        expect(DRAFTS_TITLE).toBe('नेट नसताना केलेल्या नोंदी');
        expect(DRAFTS_TITLE).not.toMatch(/आवाज|तपासायच्या/);
    });

    it('the date is the farm\'s day in Marathi with the part of the day; an unreadable one reads "—", not a made-up time', () => {
        // 23:30 UTC on 12 Aug is 05:00 IST on 13 Aug — the farm's day, not the device's
        expect(formatRecordedAt('2026-08-12T23:30:00.000Z')).toBe('13 ऑग, पहाटे 5:00');
        // a zone-less literal is a wall clock: its day and time are as written
        expect(formatRecordedAt('2026-08-13T09:15:00')).toBe('13 ऑग, सकाळी 9:15');
        expect(formatRecordedAt('nonsense')).toBe('—');
        expect(formatRecordedAt('')).toBe('—');
    });

    it('each kind of note is named for what it is', () => {
        expect(previewLabel(job('receipt_extract'))).toBe('बिलाचा फोटो');
        expect(previewLabel(job('patti_extract'))).toBe('पट्टीचा फोटो');
        expect(previewLabel(job('voice_parse'))).toBe('आवाज नोंद');
        // what he said wins over the generic name
        expect(previewLabel(job('voice_parse', { parsedLog: { summary: 'फवारणी झाली' } }))).toBe('फवारणी झाली');
        expect(previewLabel(job('voice_parse', {}, 'आज पाणी दिलं'))).toBe('आज पाणी दिलं');
    });

    it('the discard question names the thing with the right gender', () => {
        expect(discardConfirmMessage(job('voice_parse'))).toBe('ही आवाज नोंद काढून टाकायची? ती शेतनोंदीत जाणार नाही.');
        expect(discardConfirmMessage(job('patti_extract'))).toBe('हा पट्टीचा फोटो काढून टाकायचा? तो शेतनोंदीत जाणार नाही.');
    });

    it('the saved-with-warning line opens with the approved phone claim and is Marathi only', () => {
        const message = savedWithWarningMessage();
        expect(message.startsWith('लक्षात ठेवलं ✓')).toBe(true);
        expect(message).not.toMatch(/[A-Za-z]/);
    });
});
