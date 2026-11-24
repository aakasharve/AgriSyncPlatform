/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F7) - the server's own question for an answer with no work (`unclearSegments[].userMessage`).
 * `useVoiceRecorder` is at its line ceiling, so the small piece that remembers it lives here: the recorder calls `noWorkError`
 * where it used to read `response.summary`; the nothing-understood card reads the question with `useNoWorkQuestion`. Display only.
 */
import { useSyncExternalStore } from 'react';

let question: string | null = null;
const listeners = new Set<() => void>();

/** Called by the recorder for an answer with no work: remembers the server's question and returns the error text it always used. */
export function noWorkError(response: { summary?: string; unclearSegments?: ReadonlyArray<{ userMessage?: string; userMessageEn?: string }> }): string {
    // Marathi and English both kept: the card picks by its own language.
    const first = (response.unclearSegments ?? []).find(s => !!s.userMessage?.trim() || !!s.userMessageEn?.trim());
    question = first ? JSON.stringify({ mr: first.userMessage?.trim() ?? '', en: first.userMessageEn?.trim() ?? '' }) : null;
    listeners.forEach(l => l());
    return response.summary || 'Input seems unrelated to selected crop.';
}

const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The server's question for the latest no-work answer in this language (Marathi falls back to nothing, never to English). */
export function useNoWorkQuestion(language: string | null | undefined): string | null {
    const raw = useSyncExternalStore(subscribe, () => question, () => null);
    if (!raw) return null;
    const both = JSON.parse(raw) as { mr: string; en: string };
    return (language === 'en' ? both.en : both.mr) || null;
}

export const clearNoWorkQuestionForTests = (): void => { question = null; listeners.forEach(l => l()); };
