/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-4; founder D-146) - one collapsed row of the शेड्यूल tab: a big tap area with a
 * title and one short line (a count), closed by default; the content is drawn only while it is open. Nothing is removed by folding: it is
 * the same content, one tap away.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export const ScheduleFold: React.FC<{
    id: string;
    title: string;
    /** One short line, usually a count read from the data already on the phone. */
    summary?: string;
    count?: number;
    defaultOpen?: boolean;
    children: React.ReactNode;
}> = ({ id, title, summary, count, defaultOpen = false, children }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section data-testid={`fold-${id}`} data-open={open ? 'yes' : 'no'}>
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`fold-${id}-toggle`} data-count={count ?? ''}
                className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white/90 px-4 py-2.5 text-left shadow-sm active:scale-[0.99]">
                <span className="min-w-0 flex-1">
                    <span className="block text-[18px] font-extrabold leading-snug text-stone-900">{title}</span>
                    {summary && <span className="block text-[14px] font-bold text-stone-600">{summary}</span>}
                </span>
                {open ? <ChevronDown size={24} className="shrink-0 text-stone-600" aria-hidden="true" /> : <ChevronRight size={24} className="shrink-0 text-stone-600" aria-hidden="true" />}
            </button>
            {open && <div className="mt-2 space-y-3" data-testid={`fold-${id}-body`}>{children}</div>}
        </section>
    );
};

export default ScheduleFold;
