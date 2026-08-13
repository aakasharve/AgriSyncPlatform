/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SurfaceSection — one labelled zone on the post-save surface.
 *
 * WHY (founder, 2026-08-13: "too many things together… it's cluttered and
 * showcasing information but not clear"): the surface stacked eight unlabelled
 * white cards — score, crop summary, clarity line, insight, question, streak,
 * task-close, actions. Every card had the same weight, so nothing had priority
 * and no card said what it WAS.
 *
 * Each zone now carries a one-word Marathi eyebrow and an accent colour keyed to
 * WHAT KIND OF THING it is — the farmer learns the code once and can then read
 * the screen by colour alone:
 *
 *   work      GREEN     — what YOU did today          (fact, already true)
 *   grasp     BLUE      — what SATHI understood        (the /10, its meaning)
 *   ask       MARIGOLD  — what Sathi still wants        (needs you)
 *   streak    EMERALD   — your consistency             (reward)
 *
 * Green and blue are the character screen's own two colours — the waveform ramps
 * green→blue, so "what you did → what I understood" is already the product's
 * visual grammar. Marigold is the deliberate third: it is the flower on every
 * Maharashtra farm gate, warm rather than alarming, and critically it is NOT red.
 * A question to a farmer is never an error.
 */
import React from 'react';
import { useLanguage } from '../../../../i18n/LanguageContext';

const SANS = "'Noto Sans Devanagari', sans-serif";

export type SectionTone = 'work' | 'grasp' | 'ask' | 'streak';

const TONE: Record<SectionTone, { accent: string; tint: string; edge: string }> = {
    work: { accent: '#15803D', tint: '#F2FAF4', edge: '#D7EEDF' },
    grasp: { accent: '#1E56E6', tint: '#F3F6FE', edge: '#D8E2FB' },
    ask: { accent: '#B4650F', tint: '#FEF8EF', edge: '#F6E3C4' },
    streak: { accent: '#047857', tint: '#F1FAF6', edge: '#D2EDE2' },
};

export interface SurfaceSectionProps {
    tone: SectionTone;
    /** i18n key for the eyebrow, e.g. 'dfes.sectionWork'. Translated here — the
     *  hook-free mainView render functions have no language in scope. */
    labelKey: string;
    /**
     * Optional i18n key for a short line under the eyebrow. Used by the question
     * zone to say WHY answering matters ("हे सांगितलं तर आकडा वाढेल") — that is
     * what turns the score from a verdict into something with a next move.
     */
    noteKey?: string;
    children: React.ReactNode;
    testId?: string;
}

export function SurfaceSection({
    tone, labelKey, noteKey, children, testId,
}: SurfaceSectionProps): React.ReactElement {
    const { t: translate } = useLanguage();
    const label = translate(labelKey);
    const note = noteKey ? translate(noteKey) : null;
    const t = TONE[tone];
    return (
        <section
            data-testid={testId}
            data-tone={tone}
            style={{
                background: t.tint,
                border: `1px solid ${t.edge}`,
                borderRadius: 18,
                padding: '10px 12px 12px',
                textAlign: 'left',
                marginBottom: 9,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                <span style={{ width: 4, height: 13, borderRadius: 2, background: t.accent, flex: 'none' }} />
                <span
                    style={{
                        fontFamily: SANS, fontWeight: 800, fontSize: 11.5,
                        letterSpacing: '.02em', color: t.accent,
                    }}
                >
                    {label}
                </span>
            </div>
            {note ? (
                <p
                    data-testid={testId ? `${testId}-note` : undefined}
                    style={{
                        fontFamily: SANS, fontWeight: 700, fontSize: 12.5,
                        color: t.accent, margin: '-3px 0 9px 11px', lineHeight: 1.45,
                    }}
                >
                    {note}
                </p>
            ) : null}
            {children}
        </section>
    );
}

export default SurfaceSection;
