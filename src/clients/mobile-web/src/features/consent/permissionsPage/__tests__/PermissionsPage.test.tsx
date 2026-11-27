// @vitest-environment jsdom
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A; R1 item 02)
//
// The founder's V6c-A, pinned: one plain text; both switches ON when the page opens and the words SAY so (never "only if
// you turn it on"); no percentage anywhere; a grey button that only scrolls until the end has been on screen, then the
// green deliberate one; "नको" sends nothing; one language at a time; and the hash covers exactly what is drawn.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PermissionsPage from '../PermissionsPage';
import { permissionsPageWords } from '../permissionsPageWords';
import { canonicalPermissionsPageText } from '../permissionsPageNotice';

vi.mock('../../../legal/LegalDocumentView', () => ({
    default: ({ doc }: { doc: string }) => <div data-testid={`legal-${doc}`}>doc</div>,
}));

afterEach(cleanup);

/** Gives the scroll box a real-looking size: content 2000 px tall in a 600 px window. */
function sizeScrollBox(scrollTop = 0): HTMLElement {
    const el = screen.getByTestId('permissions-page-scroll');
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
    fireEvent.scroll(el);
    return el;
}

function renderPage(over: Partial<React.ComponentProps<typeof PermissionsPage>> = {}) {
    const props = {
        language: 'mr' as const,
        onLanguage: vi.fn(),
        recording: false,
        onAccept: vi.fn(),
        onDecline: vi.fn(),
        ...over,
    };
    render(<PermissionsPage {...props} />);
    return props;
}

describe('V6c-A: switches ON by default, and the words say so', () => {
    it('both switches are ON when the page opens', () => {
        renderPage();
        expect(screen.getByTestId('permissions-switch-voicePlayback')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('permissions-switch-improvement')).toHaveAttribute('aria-checked', 'true');
    });

    it('says they are on and can be turned off — never "only if you turn it on"', () => {
        renderPage();
        const mr = permissionsPageWords('mr');
        expect(screen.getByTestId('permissions-page-switches-on')).toHaveTextContent(mr.switchesOn);
        expect(mr.switchesOn).toBe('खालची दोन्ही बटणं आत्ता चालू आहेत. नको असेल तर बंद करा.');
        const text = screen.getByTestId('permissions-page').textContent ?? '';
        expect(text).not.toContain('फक्त तुम्ही चालू केलं तरच');
        expect(canonicalPermissionsPageText('en')).not.toMatch(/only if you turn it on/i);
        expect(permissionsPageWords('en').switchesOn).toBe('Both switches below are on now. Turn either off if you do not want it.');
    });

    it('shows no percentage anywhere (founder: no % sign)', () => {
        renderPage();
        sizeScrollBox(700);
        expect(screen.getByTestId('permissions-page').textContent).not.toMatch(/%/);
        expect(canonicalPermissionsPageText('mr')).not.toMatch(/%/);
    });
});

describe('V6c-A: the button is grey until the end has been on screen', () => {
    it('grey "शेवटपर्यंत वाचा" at the top: a tap scrolls on and accepts nothing', async () => {
        const props = renderPage();
        const box = sizeScrollBox(0);
        box.scrollBy = vi.fn();
        const go = screen.getByTestId('permissions-page-go');
        expect(go).toHaveAttribute('data-ready', 'no');
        expect(go).toHaveTextContent('शेवटपर्यंत वाचा');
        await userEvent.click(go);
        expect(props.onAccept).not.toHaveBeenCalled();
        expect(box.scrollBy).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('permissions-page-bar')).toHaveAttribute('data-reached', 'no');
    });

    it('at the end it turns into "मी वाचलं, पुढे चला"; scrolling back up keeps it; ONE tap accepts with both ON', async () => {
        const props = renderPage();
        const box = sizeScrollBox(0);
        box.scrollTop = 1400; // max = 2000 - 600
        fireEvent.scroll(box);
        const go = screen.getByTestId('permissions-page-go');
        expect(go).toHaveAttribute('data-ready', 'yes');
        expect(go).toHaveTextContent('मी वाचलं, पुढे चला');
        expect(screen.getByTestId('permissions-page-bar')).toHaveAttribute('data-reached', 'yes');

        box.scrollTop = 200;
        fireEvent.scroll(box);
        expect(go).toHaveAttribute('data-ready', 'yes');

        expect(props.onAccept).not.toHaveBeenCalled(); // reaching the end records nothing
        await userEvent.click(go);
        expect(props.onAccept).toHaveBeenCalledTimes(1);
        expect(props.onAccept).toHaveBeenCalledWith({ voicePlayback: true, improvement: true });
    });

    it('a switch he turned off is sent off', async () => {
        const props = renderPage();
        await userEvent.click(screen.getByTestId('permissions-switch-improvement'));
        expect(screen.getByTestId('permissions-switch-improvement')).toHaveAttribute('aria-checked', 'false');
        const box = sizeScrollBox(1400);
        expect(box).toBeTruthy();
        await userEvent.click(screen.getByTestId('permissions-page-go'));
        expect(props.onAccept).toHaveBeenCalledWith({ voicePlayback: true, improvement: false });
    });

    it('while the acceptance is being written the button is held (no second tap)', async () => {
        const props = renderPage({ recording: true });
        sizeScrollBox(1400);
        const go = screen.getByTestId('permissions-page-go');
        expect(go).toBeDisabled();
        expect(go).toHaveTextContent(permissionsPageWords('mr').saving);
        await userEvent.click(go);
        expect(props.onAccept).not.toHaveBeenCalled();
    });

    it('"नको" declines and accepts nothing, at any point', async () => {
        const props = renderPage();
        sizeScrollBox(0);
        await userEvent.click(screen.getByTestId('permissions-page-no'));
        expect(props.onDecline).toHaveBeenCalledTimes(1);
        expect(props.onAccept).not.toHaveBeenCalled();
        expect(screen.getByText(permissionsPageWords('mr').noLine)).toBeInTheDocument();
    });
});

describe('one language at a time, and the hash covers exactly what is drawn', () => {
    it('Marathi mode: the language switch asks for English; the page is drawn in Marathi', async () => {
        const props = renderPage();
        expect(screen.getByRole('heading', { name: 'परवानग्या आणि गोपनीयता' })).toBeInTheDocument();
        await userEvent.click(screen.getByTestId('permissions-page-lang-en'));
        expect(props.onLanguage).toHaveBeenCalledWith('en');
    });

    it('English mode: the page\'s own lines are English', () => {
        renderPage({ language: 'en' });
        expect(screen.getByRole('heading', { name: 'Permissions and privacy' })).toBeInTheDocument();
        const en = permissionsPageWords('en');
        for (const line of [en.readAll, en.switchesOn, en.earlierChoiceStays, en.statement, en.age, en.noLine, en.notNow, ...en.whoSees]) {
            expect(line).not.toMatch(/[ऀ-ॿ]/);
        }
        expect(screen.getByTestId('permissions-page-go')).toHaveTextContent('Read to the end');
    });

    it.each(['mr', 'en'] as const)('every text line drawn in %s is in the hashed text', (language) => {
        renderPage({ language });
        const canonical = canonicalPermissionsPageText(language);
        const body = screen.getByTestId('permissions-page-text');
        const nodes = Array.from(body.querySelectorAll('h2, p, span, button'))
            .filter((el) => el.children.length === 0)
            .map((el) => (el.textContent ?? '').trim())
            .filter(Boolean);
        expect(nodes.length).toBeGreaterThan(15);
        for (const text of nodes) expect(canonical).toContain(text);
        for (const id of ['go', 'no'] as const) {
            expect(canonical).toContain((screen.getByTestId(`permissions-page-${id}`).textContent ?? '').trim());
        }
    });

    it('the Terms and the Privacy Policy open in place and come back to the page', async () => {
        renderPage();
        await userEvent.click(screen.getByTestId('permissions-page-terms'));
        expect(screen.getByTestId('legal-terms')).toBeInTheDocument();
        expect(screen.queryByTestId('permissions-page-text')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: /परवानग्या आणि गोपनीयता/ }));
        expect(screen.getByTestId('permissions-page-text')).toBeInTheDocument();
    });
});
