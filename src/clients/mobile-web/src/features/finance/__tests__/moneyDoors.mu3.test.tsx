// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 (plan step 4a; founder D-22 "work access ≠ money access", doctrine P4) — the money doors follow
 * the SERVER's see-money answer, never the label: the पैसे व हिशोब door is not drawn for a seat that does
 * not see money, every money page says so in ShramSafal's rule's words (fix 1, item 16 W2) instead of an empty book
 * that reads as ₹0, and आढावा's money section says the same. The owner (and a सहमालक the owner lets see money) keeps every door.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mayShowFarmMoney } from '../../labour/homeAttendanceDoor';
import { AUTHORITY, holdsAuthority } from '../../../core/session/farmAuthorities';
import { SetupHubMenu } from '../../profile/components/SetupHubMenu';
import { MoneyWithheldPage } from '../components/MoneyWithheldPage';
import { reflectCopy } from '../../reflect/reflectCopy';

afterEach(cleanup);

describe('the money doors follow see money (lane MU-3)', () => {
    it('the server\'s answer wins over the label, both ways; without one only the primary account holder', () => {
        expect(mayShowFarmMoney('SecondaryOwner', true)).toBe(true);
        expect(mayShowFarmMoney('PrimaryOwner', true)).toBe(true);
        expect(mayShowFarmMoney('SecondaryOwner', false)).toBe(false);
        expect(mayShowFarmMoney('PrimaryOwner')).toBe(true);
        expect(mayShowFarmMoney('SecondaryOwner')).toBe(false);
        expect(mayShowFarmMoney(null)).toBe(false);
    });

    it('a seat\'s see-money answer is read from /me/context, and only the primary owner keeps it when the server sent none', () => {
        const coOwnerMoneyOff = { role: 'SecondaryOwner', authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }] };
        const coOwnerMoneyOn = { role: 'SecondaryOwner', authorities: [{ name: 'SeeMoney', expiresAtUtc: null }] };
        expect(holdsAuthority(coOwnerMoneyOff, AUTHORITY.seeMoney)).toBe(false);
        expect(holdsAuthority(coOwnerMoneyOn, AUTHORITY.seeMoney)).toBe(true);
        expect(holdsAuthority({ role: 'PrimaryOwner', authorities: null }, AUTHORITY.seeMoney)).toBe(true);
    });

    it('the सेट-अप केंद्र draws पैसे व हिशोब only when it is handed a way in', () => {
        const base = { farmerName: 'रवी', verified: false, items: [], onSelect: vi.fn(), logout: vi.fn() };
        const { rerender } = render(<SetupHubMenu {...base} />);
        expect(screen.queryByTestId('hub-money')).toBeNull();
        expect(screen.queryByText('पैसे व हिशोब')).toBeNull();
        rerender(<SetupHubMenu {...base} onOpenFinance={vi.fn()} />);
        expect(screen.getByTestId('hub-finance')).toBeTruthy();
    });

    it('a money page for a seat that does not see money says so — never an empty book, never ₹0', () => {
        const onBack = vi.fn();
        render(<MoneyWithheldPage onBack={onBack} />);
        const page = screen.getByTestId('money-withheld-page');
        // Fix 1 (item 16, W2): ShramSafal's rule, never "not shown to you", never pointing at the owner.
        expect(page.textContent).toContain('श्रमसफलच्या नियमानुसार पैशांचा हिशोब इथे दिसत नाही.');
        expect(page.textContent).not.toMatch(/₹|0\.00|AI|policy|permission|role|access|तुम्हाला|मालक/);
        cleanup();
        render(<MoneyWithheldPage onBack={onBack} language="en" />);
        const en = screen.getByTestId('money-withheld-page').textContent ?? '';
        expect(en).toContain("By ShramSafal's rules, the money accounts are not shown here.");
        expect(en).not.toMatch(/[ऀ-ॿ]|to you|owner/);
    });

    it('every पैसे व हिशोब route answers a seat without see money with the withheld page, and the hub gets no door', async () => {
        const routes = await import('../../../core/navigation/simpleRoutes');
        const ctx = (route: string, maySeeMoney: boolean | undefined) =>
            ({ currentRoute: route, maySeeMoney, setCurrentRoute: vi.fn(), goBackOr: vi.fn() }) as never;
        const renderers = [
            ['finance-manager', routes.renderFinanceManagerRoute],
            ['finance-ledger', routes.renderFinanceLedgerRoute],
            ['finance-price-book', routes.renderFinancePriceBookRoute],
            ['finance-review-inbox', routes.renderFinanceReviewInboxRoute],
            ['finance-reports', routes.renderFinanceReportsRoute],
        ] as const;
        for (const [route, renderRoute] of renderers) {
            expect((renderRoute(ctx(route, false)) as React.ReactElement).type).toBe(MoneyWithheldPage);
            expect((renderRoute(ctx(route, true)) as React.ReactElement).type).not.toBe(MoneyWithheldPage);
            expect((renderRoute(ctx(route, undefined)) as React.ReactElement).type).not.toBe(MoneyWithheldPage);
        }

        const profile = (maySeeMoney: boolean | undefined) => {
            const el = routes.renderProfileRoute({ ...(ctx('profile', maySeeMoney) as object), crops: [] } as never) as React.ReactElement<{ children: React.ReactElement<{ onOpenFinanceManager?: unknown }> }>;
            return el.props.children.props.onOpenFinanceManager;
        };
        expect(profile(false)).toBeUndefined();
        expect(typeof profile(true)).toBe('function');
    });

    it('आढावा\'s hidden-money line is true for whoever reads it (not "only the main owner")', () => {
        expect(reflectCopy('mr').moneyHidden).toBe('श्रमसफलच्या नियमानुसार पैशांचा हिशोब इथे दिसत नाही.');
        expect(reflectCopy('mr').moneyHidden).not.toMatch(/मुख्य मालक|तुम्हाला|AI|policy|permission|role|access/);
        expect(reflectCopy('en').moneyHidden).toBe("By ShramSafal's rules, the money accounts are not shown here.");
    });
});
