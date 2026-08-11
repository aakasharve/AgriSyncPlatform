/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourDataPoints — the ONE canonical display of a labour entry's data points
 * (👷 count · ⏱ shift · 🌿 task · 💰 amount · 🧑 names). Used everywhere a
 * labour entry appears — attendance capture, review sheet, reflect page,
 * worker — so the same facts read the same on every screen.
 */
import React from 'react';
import { Users, Clock, Sprout, Wallet, User } from 'lucide-react';
import type { LabourEntry } from '../labourParse';
import { SHIFT_LABEL } from '../labourParse';
import { inr } from '../labourMock';

/**
 * Latin digits -> Devanagari digits. Exported because the labour hub's "just
 * logged" card renders the same `N मजूर` phrase and must not grow a fourth
 * private copy of this one-liner.
 */
export const toMr = (n: number) => String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]);

type Tone = 'em' | 'am' | 'or' | 'bl' | 'vi';
const TONE: Record<Tone, string> = {
    em: 'bg-emerald-50 text-emerald-700',
    am: 'bg-amber-100 text-amber-700',
    or: 'bg-orange-100 text-orange-700',
    bl: 'bg-blue-50 text-blue-700',
    vi: 'bg-violet-100 text-violet-700',
};

const Chip: React.FC<{ icon: React.ReactNode; label: string; tone: Tone }> = ({ icon, label, tone }) => (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-bold ${TONE[tone]}`}>{icon} {label}</span>
);

const LabourDataPoints: React.FC<{ entry: Partial<LabourEntry> }> = ({ entry }) => {
    const chips: React.ReactNode[] = [];
    if (entry.count != null) chips.push(<Chip key="c" icon={<Users size={13} />} label={`${toMr(entry.count)} मजूर`} tone="em" />);
    if (entry.shift) chips.push(<Chip key="s" icon={<Clock size={13} />} label={SHIFT_LABEL[entry.shift]} tone={entry.shift === 'half' ? 'am' : entry.shift === 'night' ? 'or' : 'em'} />);
    if (entry.task) chips.push(<Chip key="t" icon={<Sprout size={13} />} label={entry.task} tone="bl" />);
    if (entry.amount != null) chips.push(<Chip key="a" icon={<Wallet size={13} />} label={inr(entry.amount)} tone="am" />);
    if (entry.names && entry.names.length) chips.push(<Chip key="n" icon={<User size={13} />} label={entry.names.join(', ')} tone="vi" />);
    if (!chips.length) return null;
    return <div className="flex flex-wrap gap-1.5">{chips}</div>;
};

export default LabourDataPoints;
