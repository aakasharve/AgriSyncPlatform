// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 — the photo/file upload states in Marathi.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AttachmentStatusBadge from '../AttachmentStatusBadge';

describe('AttachmentStatusBadge', () => {
    afterEach(cleanup);

    it.each([
        ['pending', 'पाठवायचा बाकी'],
        ['retry_wait', 'पाठवायचा बाकी'],
        ['uploading', 'पाठवत आहे'],
        ['finalized', 'पाठवला'],
        ['failed', 'पाठवता आला नाही'],
    ])('%s says %s, with no English', (status, label) => {
        const { container } = render(<AttachmentStatusBadge status={status} />);
        expect(screen.getByTestId('attachment-status')).toHaveTextContent(label);
        expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/);
    });

    it('a failed upload can be sent again from the badge', () => {
        const onRetry = vi.fn();
        render(<AttachmentStatusBadge status="failed" onRetry={onRetry} />);
        fireEvent.click(screen.getByRole('button', { name: 'पुन्हा पाठवा' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
