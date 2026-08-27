// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ANTI-FABRICATION GUARDRAIL — provenanceVerified render coverage
 * (spec: dfes-companion-2026-07-11).
 *
 * Founder-caught bug: the AI fabricated a phrase inside an item's
 * `sourceText`, then extracted a whole activity from its own invention.
 * The backend (`AiResponseNormalizer.NormalizeVoiceJson`) now stamps
 * `provenanceVerified: false` on any item whose sourceText could not be
 * matched against the transcript. This test proves the review-screen
 * bucket card renders a gentle "please check this" flag ONLY when that
 * flag is explicitly `false` — never on `true`, and never when the key is
 * simply absent (the contract for manual entries and pre-existing data).
 */
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { Users } from 'lucide-react';
import BucketItem from '../BucketItem';

afterEach(cleanup);

const baseProps = {
    icon: <Users />,
    label: 'Labour & Wages',
    filled: true,
    onClick: () => undefined,
    sourceText: 'दोन मजूर आले होते',
};

describe('BucketItem — provenanceVerified flag', () => {
    it('renders the unverified flag when provenanceVerified is false', () => {
        render(<BucketItem {...baseProps} provenanceVerified={false} />);
        expect(screen.getByTestId('provenance-unverified-flag')).toBeInTheDocument();
        expect(screen.getByText('हे मी नक्की ऐकलं नाही — बरोबर आहे का?')).toBeInTheDocument();
        // The original transcript quote is still shown — we never hide it.
        expect(screen.getByText('"दोन मजूर आले होते"')).toBeInTheDocument();
    });

    it('does NOT render the flag when provenanceVerified is true', () => {
        render(<BucketItem {...baseProps} provenanceVerified={true} />);
        expect(screen.queryByTestId('provenance-unverified-flag')).not.toBeInTheDocument();
    });

    it('does NOT render the flag when provenanceVerified is absent (manual entries, pre-existing data)', () => {
        render(<BucketItem {...baseProps} />);
        expect(screen.queryByTestId('provenance-unverified-flag')).not.toBeInTheDocument();
    });

    it('does not crash and renders nothing extra when there is no sourceText at all', () => {
        render(
            <BucketItem
                icon={<Users />}
                label="Labour & Wages"
                filled={true}
                onClick={() => undefined}
                provenanceVerified={false}
            />
        );
        expect(screen.queryByTestId('provenance-unverified-flag')).not.toBeInTheDocument();
    });
});
