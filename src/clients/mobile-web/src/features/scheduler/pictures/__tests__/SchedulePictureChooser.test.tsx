// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148 default 2) - the owner's photo action on the owner bar:
 * shown to the OWNER of the schedule only; picks a photo, shrinks an oversize one on the phone, sends the raw bytes in a direct call, and removes with
 * "फोटो काढून टाका". Offline it says so and keeps nothing (no outbox row, no queue row). Plain Marathi (and English) messages, 44 px tap targets, no emoji.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let language: 'mr' | 'en' = 'mr';
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language, setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language, setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The signed-in person as the session marker says it (the owner bar asks the session, not a prop).
let sessionUser: string | null = null;
vi.mock('../../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../infrastructure/storage/AuthTokenStore')>()),
    getSessionUserId: () => sessionUser,
}));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { ScheduleOwnerBar } from '../../schedulePage/ScheduleOwnerBar';
import { SchedulePictureChooser, isOwnersSchedule, type PictureActions } from '../SchedulePictureChooser';
import { PICTURE_WORDS } from '../schedulePictureCopy';
import { MAX_PICTURE_BYTES, type ShrinkEngine } from '../shrinkPicture';
import type { CropScheduleTemplate } from '../../scheduler.types';

const ME = '11111111-2222-4333-8444-555555555555';
const SCHEDULE_ID = '3f2a1c9e-5b7d-4e21-8a90-1c2d3e4f5a6b';
const KB = 1024;

const own = (extra: Partial<CropScheduleTemplate> = {}) => ({ id: SCHEDULE_ID, ownerUserId: ME, ...extra }) as Pick<CropScheduleTemplate, 'id' | 'ownerUserId' | 'pictureKind'>;

/** An engine that makes a 4000 x 3000 photo into a 120 KB JPEG at 512 px (and records what it was asked). */
function engine(): ShrinkEngine & { encoded: Array<[number, number]> } {
    const encoded: Array<[number, number]> = [];
    return {
        encoded,
        decode: async () => ({ width: 4000, height: 3000, handle: {} }),
        encode: async (_p, w, h) => { encoded.push([w, h]); return new Blob([new Uint8Array(120 * KB)], { type: 'image/jpeg' }); },
    };
}

function actions(answer: Awaited<ReturnType<PictureActions['putPerson']>> = { ok: true }) {
    return {
        putPerson: vi.fn(async () => answer),
        removePerson: vi.fn(async () => answer),
        putSchedule: vi.fn(async () => answer),
        removeSchedule: vi.fn(async () => answer),
    } satisfies PictureActions;
}

const photo = (name = 'photo.jpg') => new File([new Uint8Array(5 * 1024 * KB)], name, { type: 'image/jpeg' });
const pick = (kind: 'PERSON' | 'SCHEDULE', file: File = photo()) => fireEvent.change(screen.getByTestId(`picture-file-${kind}`), { target: { files: [file] } });
const open = () => fireEvent.click(screen.getByTestId('picture-open'));
const status = () => screen.getByTestId('picture-status');

beforeEach(() => { language = 'mr'; sessionUser = null; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('who sees the action', () => {
    it('only the person the schedule belongs to: the owner\'s id is the signed-in id', () => {
        expect(isOwnersSchedule({ ownerUserId: ME }, ME)).toBe(true);
        expect(isOwnersSchedule({ ownerUserId: ME.toUpperCase() }, ME)).toBe(true);
        expect(isOwnersSchedule({ ownerUserId: ME }, '99999999-2222-4333-8444-555555555555')).toBe(false);
        expect(isOwnersSchedule({ ownerUserId: ME }, null)).toBe(false);
        expect(isOwnersSchedule({}, ME)).toBe(false);
    });

    it('draws nothing for an outside schedule, a schedule of someone else, or when nobody is signed in', () => {
        const { container, rerender } = render(<SchedulePictureChooser template={{ id: SCHEDULE_ID }} currentUserId={ME} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<SchedulePictureChooser template={own()} currentUserId="99999999-2222-4333-8444-555555555555" />);
        expect(container).toBeEmptyDOMElement();
        rerender(<SchedulePictureChooser template={own()} currentUserId={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('on the owner bar: the owner of the schedule gets "फोटो लावा"; a worker, a co-owner or a stranger looking at the same schedule gets nothing', () => {
        const template = { id: SCHEDULE_ID, name: 'x', cropCode: 'GRAPES', ownerType: 'USER', createdBy: 'अशोक', ownerUserId: ME, stages: [], periodicExpectations: [], oneTimeExpectations: [] } as unknown as CropScheduleTemplate;
        sessionUser = ME;
        render(<ScheduleOwnerBar template={template} />);
        expect(screen.getByTestId('picture-open')).toHaveTextContent('फोटो लावा');
        cleanup();
        sessionUser = '99999999-2222-4333-8444-555555555555';
        render(<ScheduleOwnerBar template={template} />);
        expect(screen.queryByTestId('picture-open')).toBeNull();
        cleanup();
        sessionUser = null;
        render(<ScheduleOwnerBar template={template} />);
        expect(screen.queryByTestId('picture-open')).toBeNull();
        cleanup();
        // an outside schedule (no owner person) never shows it, even to a signed-in person
        sessionUser = ME;
        render(<ScheduleOwnerBar template={{ ...template, ownerUserId: undefined }} />);
        expect(screen.queryByTestId('picture-open')).toBeNull();
    });
});

describe('the panel', () => {
    it('opens on "फोटो लावा" with who-sees-it words and two choices, each with a 44 px "फोटो निवडा"; "फोटो काढून टाका" only on the picture that is showing', () => {
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={actions()} engine={engine()} />);
        expect(screen.getByTestId('picture-open')).toHaveTextContent('फोटो लावा');
        open();
        expect(screen.getByTestId('picture-notice')).toHaveTextContent('ज्यांना तुमचं शेड्यूल दिसतं');
        expect(screen.getByTestId('picture-row-PERSON')).toHaveTextContent('माझा फोटो');
        expect(screen.getByTestId('picture-row-SCHEDULE')).toHaveTextContent('या शेड्यूलचं चित्र');
        for (const kind of ['PERSON', 'SCHEDULE']) {
            expect(screen.getByTestId(`picture-choose-${kind}`)).toHaveTextContent('फोटो निवडा');
            expect(screen.getByTestId(`picture-choose-${kind}`).className).toContain('min-h-[44px]');
        }
        expect(screen.queryByTestId('picture-remove-PERSON')).toBeNull();
        expect(screen.queryByTestId('picture-remove-SCHEDULE')).toBeNull();
        expect(screen.getByTestId('picture-close').className).toContain('h-11');
    });

    it('with his own photo showing, the bar says "फोटो बदला" and the photo row offers "फोटो काढून टाका"', () => {
        render(<SchedulePictureChooser template={own({ pictureKind: 'PERSON' })} currentUserId={ME} actions={actions()} engine={engine()} />);
        expect(screen.getByTestId('picture-open')).toHaveTextContent('फोटो बदला');
        open();
        expect(screen.getByTestId('picture-remove-PERSON')).toHaveTextContent('फोटो काढून टाका');
        expect(screen.queryByTestId('picture-remove-SCHEDULE')).toBeNull();
    });

    it('an institution\'s logo showing is not his to change: no "फोटो काढून टाका" for it', () => {
        render(<SchedulePictureChooser template={own({ pictureKind: 'INSTITUTION' })} currentUserId={ME} actions={actions()} engine={engine()} />);
        expect(screen.getByTestId('picture-open')).toHaveTextContent('फोटो लावा');
        open();
        expect(screen.queryByTestId('picture-remove-PERSON')).toBeNull();
        expect(screen.queryByTestId('picture-remove-SCHEDULE')).toBeNull();
    });

    it('speaks English in English mode', () => {
        language = 'en';
        render(<SchedulePictureChooser template={own({ pictureKind: 'SCHEDULE' })} currentUserId={ME} actions={actions()} engine={engine()} />);
        expect(screen.getByTestId('picture-open')).toHaveTextContent('Change photo');
        open();
        expect(screen.getByTestId('picture-remove-SCHEDULE')).toHaveTextContent('Remove photo');
        expect(screen.getByTestId('picture-notice')).toHaveTextContent('Anyone who can see your schedule');
    });
});

describe('choosing a photo', () => {
    it('shrinks a 5 MB phone photo to 512 px and a JPEG under 512 KB, then sends those raw bytes as HIS photo (and asks for a sync)', async () => {
        const a = actions();
        const eng = engine();
        const changed = vi.fn();
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={a} engine={eng} onChanged={changed} />);
        open();
        pick('PERSON');
        await waitFor(() => expect(a.putPerson).toHaveBeenCalledTimes(1));
        const sent = (a.putPerson.mock.calls[0] as unknown as [Blob])[0];
        expect(sent).toBeInstanceOf(Blob);
        expect(sent.type).toBe('image/jpeg');
        expect(sent.size).toBeLessThanOrEqual(MAX_PICTURE_BYTES);
        expect(sent.size).toBeLessThan(5 * 1024 * KB);
        expect(eng.encoded[0]).toEqual([512, 384]);
        expect(a.putSchedule).not.toHaveBeenCalled();
        await waitFor(() => expect(status()).toHaveTextContent('फोटो ठेवला'));
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it('the schedule\'s picture goes to the schedule path with this schedule\'s id', async () => {
        const a = actions();
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={a} engine={engine()} onChanged={vi.fn()} />);
        open();
        pick('SCHEDULE');
        await waitFor(() => expect(a.putSchedule).toHaveBeenCalledTimes(1));
        expect((a.putSchedule.mock.calls[0] as unknown as [string, Blob])[0]).toBe(SCHEDULE_ID);
        expect(a.putPerson).not.toHaveBeenCalled();
    });

    it('a photo that cannot be opened says so in plain Marathi and sends nothing', async () => {
        const a = actions();
        const broken: ShrinkEngine = { decode: async () => null, encode: async () => null };
        const changed = vi.fn();
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={a} engine={broken} onChanged={changed} />);
        open();
        pick('PERSON');
        await waitFor(() => expect(status()).toHaveTextContent('हा फोटो उघडता आला नाही'));
        expect(status()).toHaveAttribute('data-tone', 'problem');
        expect(a.putPerson).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
    });

    it('a refusal from the server is said in plain words (too large, not allowed)', async () => {
        const tooLarge = actions({ ok: false, reason: 'too-large' });
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={tooLarge} engine={engine()} onChanged={vi.fn()} />);
        open();
        pick('PERSON');
        await waitFor(() => expect(status()).toHaveTextContent('फोटो खूप मोठा आहे'));
        cleanup();
        const denied = actions({ ok: false, reason: 'not-allowed' });
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={denied} engine={engine()} onChanged={vi.fn()} />);
        open();
        pick('SCHEDULE');
        await waitFor(() => expect(status()).toHaveTextContent('हा फोटो तुम्हाला बदलता येत नाही'));
    });

    it('offline says so, sends nothing, and keeps NOTHING: no outbox row, no queued mutation', async () => {
        const db = getDatabase();
        const before = [await db.outbox.count(), await db.mutationQueue.count()];
        vi.stubGlobal('navigator', { onLine: false });
        const a = actions();
        const eng = engine();
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={a} engine={eng} onChanged={vi.fn()} />);
        open();
        pick('PERSON');
        await waitFor(() => expect(status()).toHaveTextContent('इंटरनेट नाही'));
        expect(status()).toHaveTextContent('काहीही नंतरसाठी ठेवलेलं नाही');
        expect(a.putPerson).not.toHaveBeenCalled();
        expect(eng.encoded).toHaveLength(0);
        expect([await db.outbox.count(), await db.mutationQueue.count()]).toEqual(before);
    });

    it('a successful change writes no outbox row and no queued mutation either (a direct call, the sync contract does not change)', async () => {
        const db = getDatabase();
        const before = [await db.outbox.count(), await db.mutationQueue.count()];
        const a = actions();
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={a} engine={engine()} onChanged={vi.fn()} />);
        open();
        pick('PERSON');
        await waitFor(() => expect(status()).toHaveTextContent('फोटो ठेवला'));
        expect([await db.outbox.count(), await db.mutationQueue.count()]).toEqual(before);
    });

    it('while it works the buttons wait, and the status says it is sending', async () => {
        let release: (r: { ok: true }) => void = () => undefined;
        const a = { ...actions(), putPerson: vi.fn(() => new Promise<{ ok: true }>(resolve => { release = resolve; })) };
        render(<SchedulePictureChooser template={own()} currentUserId={ME} actions={a} engine={engine()} onChanged={vi.fn()} />);
        open();
        pick('PERSON');
        await waitFor(() => expect(status()).toHaveTextContent('फोटो पाठवत आहे'));
        expect(screen.getByTestId('picture-choose-PERSON')).toBeDisabled();
        expect(screen.getByTestId('picture-choose-SCHEDULE')).toBeDisabled();
        release({ ok: true });
        await waitFor(() => expect(status()).toHaveTextContent('फोटो ठेवला'));
        expect(screen.getByTestId('picture-choose-PERSON')).not.toBeDisabled();
    });
});

describe('removing', () => {
    it('"फोटो काढून टाका" on his photo removes HIS photo (DELETE person), on the schedule\'s picture removes that one', async () => {
        const a = actions();
        const changed = vi.fn();
        render(<SchedulePictureChooser template={own({ pictureKind: 'PERSON' })} currentUserId={ME} actions={a} engine={engine()} onChanged={changed} />);
        open();
        fireEvent.click(screen.getByTestId('picture-remove-PERSON'));
        await waitFor(() => expect(a.removePerson).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(status()).toHaveTextContent('फोटो काढून टाकला'));
        expect(changed).toHaveBeenCalledTimes(1);
        cleanup();

        const b = actions();
        render(<SchedulePictureChooser template={own({ pictureKind: 'SCHEDULE' })} currentUserId={ME} actions={b} engine={engine()} onChanged={vi.fn()} />);
        open();
        fireEvent.click(screen.getByTestId('picture-remove-SCHEDULE'));
        await waitFor(() => expect(b.removeSchedule).toHaveBeenCalledWith(SCHEDULE_ID));
    });

    it('a removal that fails says so in plain words and is not reported as done', async () => {
        const a = actions({ ok: false, reason: 'offline' });
        const changed = vi.fn();
        render(<SchedulePictureChooser template={own({ pictureKind: 'PERSON' })} currentUserId={ME} actions={a} engine={engine()} onChanged={changed} />);
        open();
        fireEvent.click(screen.getByTestId('picture-remove-PERSON'));
        await waitFor(() => expect(status()).toHaveTextContent('इंटरनेट नाही'));
        expect(changed).not.toHaveBeenCalled();
    });
});

describe('the words', () => {
    const allWords = (lang: 'mr' | 'en'): string[] => {
        const w = PICTURE_WORDS[lang];
        return [...Object.entries(w).filter(([k]) => k !== 'problem').map(([, v]) => v as string), ...Object.values(w.problem)];
    };

    it('both languages have every word, and none carries an emoji', () => {
        for (const lang of ['mr', 'en'] as const) {
            const list = allWords(lang);
            expect(list.every(s => typeof s === 'string' && s.length > 0)).toBe(true);
            expect(list.some(s => /\p{Extended_Pictographic}/u.test(s)), lang).toBe(false);
        }
        expect(Object.keys(PICTURE_WORDS.mr.problem).sort()).toEqual(Object.keys(PICTURE_WORDS.en.problem).sort());
    });

    it('Marathi mode says Marathi only; REMOVE is "फोटो काढून टाका"', () => {
        expect(PICTURE_WORDS.mr.remove).toBe('फोटो काढून टाका');
        const devanagari = /[ऀ-ॿ]/;
        for (const s of allWords('mr')) expect(devanagari.test(s), s).toBe(true);
    });
});
