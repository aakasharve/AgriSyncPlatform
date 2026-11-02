// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 2 (review N-2).
//
// A photo not held on this phone is fetched from the server's real route WITH the sign-in token and shown through an
// object URL. It used to be `<img src="/api/attachments/{id}/download">`: the app's own origin, a route that never
// existed, and no token. A refusal or a missing photo is a plain line, never a broken image.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/api/apiFetch', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }) }));

import { apiFetch } from '../../../../infrastructure/api/apiFetch';
import AttachmentPreview from '../AttachmentPreview';
import type { AttachmentRecord } from '../../../../infrastructure/storage/DexieDatabase';

const fetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>;
const photo = (extra: Partial<AttachmentRecord> = {}) => ({
    id: 'local-1', remoteAttachmentId: 'a-1', mimeType: 'image/jpeg', originalFileName: 'पान.jpg', ...extra,
}) as unknown as AttachmentRecord;

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo-1'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); });

describe('AttachmentPreview — a photo not on this phone', () => {
    it('is fetched from /shramsafal/attachments/{id}/download through the signed-in fetch and shown from an object URL', async () => {
        fetchMock.mockResolvedValue(new Response(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }), { status: 200 }));
        render(<AttachmentPreview attachment={photo()} onClose={vi.fn()} />);

        expect(screen.getByTestId('attachment-preview-loading')).toHaveTextContent('फोटो आणत आहे…');
        const img = await screen.findByTestId('attachment-preview-image');
        expect(img).toHaveAttribute('src', 'blob:photo-1');
        expect(fetchMock).toHaveBeenCalledWith('/shramsafal/attachments/a-1/download', expect.objectContaining({ method: 'GET' }));
        // Never the app-origin path that broke it.
        expect(document.body.innerHTML).not.toContain('/api/attachments');
    });

    it.each([
        [403, 'attachment-preview-forbidden', 'हा फोटो पाहण्याची परवानगी नाही.'],
        [404, 'attachment-preview-missing', 'हा फोटो सर्व्हरवर सापडला नाही.'],
        [500, 'attachment-preview-failed', 'फोटो आणता आला नाही. नेटवर्क तपासून पुन्हा उघडा.'],
    ])('a %s answer is a plain line, never a broken image', async (status, testId, words) => {
        fetchMock.mockResolvedValue(new Response('{}', { status }));
        render(<AttachmentPreview attachment={photo()} onClose={vi.fn()} />);
        expect(await screen.findByTestId(testId)).toHaveTextContent(words);
        expect(screen.queryByTestId('attachment-preview-image')).toBeNull();
        expect(document.querySelector('img')).toBeNull();
    });

    it('no network: a plain line', async () => {
        fetchMock.mockRejectedValue(new TypeError('offline'));
        render(<AttachmentPreview attachment={photo()} onClose={vi.fn()} />);
        expect(await screen.findByTestId('attachment-preview-failed')).toBeInTheDocument();
    });
});

describe('AttachmentPreview — what is not fetched', () => {
    it('a photo held on this phone is shown from it, with no request', async () => {
        render(<AttachmentPreview attachment={photo({ localPath: 'blob:local-copy' })} onClose={vi.fn()} />);
        expect(await screen.findByTestId('attachment-preview-image')).toHaveAttribute('src', 'blob:local-copy');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a photo that has not reached the server says so, with no request', async () => {
        render(<AttachmentPreview attachment={photo({ remoteAttachmentId: undefined })} onClose={vi.fn()} />);
        expect(await screen.findByTestId('attachment-preview-notSent')).toHaveTextContent('हा फोटो अजून सर्व्हरवर पोहोचलेला नाही.');
        await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    });
});
