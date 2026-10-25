// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SeparateConfirm (design preview, founder 2026-10-25): हजेरी and मजुरी are confirmed APART, each saying who confirmed it; the wage
 * row exists only where money is shown (D-H8); a blank amount is "—", never ₹0. It sends nothing.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SeparateConfirm } from '../SeparateConfirm';
import type { ReviewItem } from '../../labour.types';

afterEach(cleanup);

const item = (points: ReviewItem['points']): ReviewItem => ({ id: 'r1', who: 'रमेश', initial: 'र', tone: 'or', detail: '', points } as unknown as ReviewItem);

describe('two separate confirmations', () => {
    it('confirming हजेरी leaves मजुरी open, and each says who confirmed', () => {
        render(<SeparateConfirm item={item({ count: 4, amount: 1200 })} confirmerLabel="मुकादम" onQuery={vi.fn()} />);
        fireEvent.click(screen.getByTestId('confirm-attendance-r1-confirm'));
        expect(screen.getByTestId('confirm-attendance-r1').textContent).toContain('मुकादम');
        expect(screen.getByTestId('confirm-wage-r1-confirm')).toBeTruthy();
        fireEvent.click(screen.getByTestId('confirm-wage-r1-confirm'));
        expect(screen.getByTestId('confirm-wage-r1').textContent).toContain('पक्कं');
    });

    it('no money on the item (not the owner\'s view): no wage row; an unknown amount is "—", never ₹0', () => {
        render(<SeparateConfirm item={item({ count: 4 })} confirmerLabel="मालक" onQuery={vi.fn()} />);
        expect(screen.queryByTestId('confirm-wage-r1')).toBeNull();
        cleanup();
        render(<SeparateConfirm item={item({ count: 4, amount: null as unknown as number })} confirmerLabel="मालक" onQuery={vi.fn()} />);
        expect(screen.getByTestId('confirm-wage-r1').textContent).toContain('—');
        expect(screen.getByTestId('confirm-wage-r1').textContent).not.toContain('₹0');
    });

    it('शंका stays available', () => {
        const onQuery = vi.fn();
        render(<SeparateConfirm item={item({ count: 4, amount: 1200 })} confirmerLabel="मालक" onQuery={onQuery} />);
        fireEvent.click(screen.getByTestId('separate-query-r1'));
        expect(onQuery).toHaveBeenCalled();
    });
});
