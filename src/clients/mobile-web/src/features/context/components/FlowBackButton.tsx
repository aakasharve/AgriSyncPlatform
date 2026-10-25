/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FlowBackButton — the big labelled "मागे" (PLR-D5). One step back, never a tiny icon: the
 * same word as today's back (`common.back`). Default is a 52px pill; `stacked` is the
 * arrow over the word, 76px tall, for a row where height is scarce (still a 64px target).
 */
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { t } from '../../../i18n/translations';

const SANS = "'Noto Sans Devanagari', sans-serif";

export const FlowBackButton: React.FC<{ onClick: () => void; testId?: string; stacked?: boolean }> = ({ onClick, testId = 'flow-back', stacked }) => (
    stacked ? (
        <button type="button" onClick={onClick} data-testid={testId} aria-label={t('common.back', 'mr')}
            className="flex h-[76px] [@media(max-height:720px)]:h-[64px] w-[64px] max-[339px]:w-[56px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border border-stone-300 bg-white text-stone-800 shadow-md active:scale-95" style={{ fontFamily: SANS }}>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
            <span className="text-[15px] font-extrabold leading-none">{t('common.back', 'mr')}</span>
        </button>
    ) : (
        <button type="button" onClick={onClick} data-testid={testId} aria-label={t('common.back', 'mr')}
            className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-md active:scale-95" style={{ fontFamily: SANS }}>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
            <span className="text-[17px] font-extrabold">{t('common.back', 'mr')}</span>
        </button>
    )
);

export default FlowBackButton;
