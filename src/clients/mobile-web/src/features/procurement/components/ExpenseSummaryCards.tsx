/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the three totals of खरेदी, in the approved look:
 * प्लॉटचा खर्च / पिकाचा सामायिक खर्च / शेताचा सामान्य खर्च. They are handed the totals of what is picked
 * (`billView.totalsOf`), not the whole farm's summary. A total with no bill behind it says "नोंद नाही" —
 * never ₹ 0 (P4).
 */
import React from 'react';
import { Home, Layers, MapPin } from 'lucide-react';
import { IconDot, type Tone } from '../../../shared/components/ui/placeUi';
import { rupees } from '../../reflect/overview/reflectDates';
import { NUM, type BillTotals, type ScopeTotal } from './billView';

interface Props {
    totals: BillTotals;
    /** The picked plot's name, when one plot is picked. */
    plotName?: string;
}

const Tile: React.FC<{ id: string; icon: React.ReactNode; tone: Tone; label: string; total: ScopeTotal; line: string }> = ({ id, icon, tone, label, total, line }) => (
    <div className="rounded-3xl border border-white/60 bg-white/80 p-2.5 shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)]" data-testid={`buy-total-${id}`}>
        <IconDot tone={tone} size={34}>{icon}</IconDot>
        <p className="m-0 mt-1.5 text-[12.5px] font-bold leading-tight text-stone-600">{label}</p>
        {total.count > 0
            ? <p className="m-0 text-[17px] font-extrabold leading-tight text-stone-900" style={{ fontFamily: NUM }} data-testid={`buy-total-${id}-amount`}>{rupees(total.amount)}</p>
            : <p className="m-0 text-[14px] font-extrabold leading-tight text-stone-500" data-testid={`buy-total-${id}-none`}>नोंद नाही</p>}
        <p className="m-0 text-[11.5px] font-semibold leading-tight text-stone-500">{line}</p>
    </div>
);

export const ExpenseSummaryCards: React.FC<Props> = ({ totals, plotName }) => (
    <div className="grid grid-cols-3 gap-2" data-testid="buy-totals">
        <Tile id="plot" icon={<MapPin size={18} aria-hidden="true" />} tone="green" label="प्लॉटचा खर्च" total={totals.plot}
            line={plotName ?? (totals.plotCount > 0 ? `${totals.plotCount} प्लॉटचा हिशोब` : 'प्लॉटवर लावलेली बिलं')} />
        <Tile id="crop" icon={<Layers size={18} aria-hidden="true" />} tone="violet" label="पिकाचा सामायिक खर्च" total={totals.crop} line="सगळ्या प्लॉटला लागणारं" />
        <Tile id="farm" icon={<Home size={18} aria-hidden="true" />} tone="blue" label="शेताचा सामान्य खर्च" total={totals.farm} line="वीज, इंधन, इतर" />
    </div>
);
