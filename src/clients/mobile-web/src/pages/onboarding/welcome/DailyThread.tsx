/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three things a farmer speaks into the day's log — did · spent · left —
 * drawn as one connected thread. Shown on the thank-you after the welcome
 * voice note.
 */
import React from 'react';
import { Hourglass, IndianRupee, Mic, Sprout } from 'lucide-react';

const THREAD: { icon: React.ReactNode; mr: string; primary?: boolean }[] = [
    { icon: <Sprout size={17} strokeWidth={2} />, mr: 'आज काय केलं', primary: true },
    { icon: <IndianRupee size={16} strokeWidth={2.2} />, mr: 'किती खर्च झाला' },
    { icon: <Hourglass size={16} strokeWidth={2} />, mr: 'काय राहिलं' },
];

const DailyThread: React.FC = () => (
    <div className="mb-3">
        <div className="mb-3 flex items-center justify-center gap-2 font-sans text-[14px] font-bold text-stone-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15">
                <Mic size={13} strokeWidth={2.5} />
            </span>
            <span>रोज मला एवढंच सांगा:</span>
        </div>
        <div className="relative mx-auto w-[238px]">
            <div className="absolute bottom-[19px] left-[15px] top-[19px] w-[1.5px] bg-emerald-500/30" aria-hidden="true" />
            {THREAD.map((r) => (
                <div key={r.mr} className="relative flex items-center gap-3 py-1">
                    <span className={`relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-emerald-700 ${r.primary ? 'bg-emerald-100 ring-1 ring-emerald-500/30' : 'bg-emerald-50 ring-1 ring-emerald-600/12'}`}>
                        {r.icon}
                    </span>
                    <span className={`font-sans text-[17px] ${r.primary ? 'font-black text-stone-900' : 'font-bold text-stone-800'}`}>{r.mr}</span>
                </div>
            ))}
        </div>
    </div>
);

export default DailyThread;
