/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — खरेदी: which bills a pick shows, what its three
 * totals add up, and where each bill goes, in plain Marathi. Pure: bills and crops in, answers out.
 *
 * THE RULE the page always had: a plot shows its own bills + its crop's shared bills + the farm-wide bills.
 * A crop with no plot picked shows the same over all its plots; "सर्व" shows every bill.
 *
 * The three totals add up exactly the PLACED bills of that view (on a plot / shared by the crop / for the
 * whole farm), so they follow the pick — they used to be `getExpenseSummary()` over the whole farm whatever
 * was picked. A total with no bill behind it has `count: 0`, and the page says "नोंद नाही", never ₹ 0 (P4).
 *
 * A plot bill's crop is the crop that HOLDS the plot: the receipt sheet fills `cropId` on a plot bill only
 * when the photo suggested a crop, so reading `cropId` alone would drop most plot bills from their crop.
 */
import type { CropProfile, ExpenseScope, ProcurementExpense } from '../../../types';

/** Font rule: figures in DM Sans, Marathi in Noto Sans Devanagari. */
export const NUM = "'DM Sans', sans-serif";

/** "सर्व" — no crop (or no plot) picked. */
export const ALL = 'all';

/** A crop id or `ALL`, and a plot id of that crop or `ALL`. */
export interface BillPick { cropId: string; plotId: string }

export interface ScopeTotal { amount: number; count: number }
export interface BillTotals { plot: ScopeTotal; crop: ScopeTotal; farm: ScopeTotal; plotCount: number }

/** Where a bill goes, as the farmer says it. */
export const SCOPE_LABEL: Record<ExpenseScope, string> = {
    PLOT: 'प्लॉटवर',
    CROP: 'पिकासाठी सामायिक',
    FARM: 'सर्व शेतासाठी',
    UNKNOWN: 'कुठे लावायचं ते ठरलेलं नाही',
};

const cropOfPlotBill = (e: ProcurementExpense, crops: readonly CropProfile[]): string | undefined =>
    crops.find(c => c.plots.some(p => p.id === e.plotId))?.id ?? e.cropId;

/** The bills for what is picked (search not applied). A bill not yet placed shows only under "सर्व". */
export function billsInView(bills: readonly ProcurementExpense[], crops: readonly CropProfile[], pick: BillPick): ProcurementExpense[] {
    if (pick.cropId === ALL) return [...bills];
    return bills.filter(e => {
        if (e.scope === 'FARM') return true;
        if (e.scope === 'CROP') return e.cropId === pick.cropId;
        if (e.scope === 'PLOT' && e.plotId) {
            return pick.plotId === ALL ? cropOfPlotBill(e, crops) === pick.cropId : e.plotId === pick.plotId;
        }
        return false;
    });
}

/** The three totals of a view: on plots, shared by a crop, for the whole farm. */
export function totalsOf(bills: readonly ProcurementExpense[]): BillTotals {
    const add = (l: readonly ProcurementExpense[]): ScopeTotal => ({ amount: l.reduce((s, e) => s + e.grandTotal, 0), count: l.length });
    const onPlots = bills.filter(e => e.scope === 'PLOT' && !!e.plotId);
    return {
        plot: add(onPlots),
        crop: add(bills.filter(e => e.scope === 'CROP' && !!e.cropId)),
        farm: add(bills.filter(e => e.scope === 'FARM')),
        plotCount: new Set(onPlots.map(e => e.plotId)).size,
    };
}

/** Search by shop or by anything on the bill (the page's old search, in any script). */
export function matchesSearch(e: ProcurementExpense, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return !!e.vendorName?.toLowerCase().includes(q) || e.lineItems.some(i => i.name.toLowerCase().includes(q));
}

/** The named place a bill goes to — its plot, or "सर्व <crop>" — or '' when it has none. */
export function placeOf(e: ProcurementExpense, crops: readonly CropProfile[]): string {
    if (e.scope === 'PLOT') return crops.flatMap(c => c.plots).find(p => p.id === e.plotId)?.name ?? '';
    if (e.scope === 'CROP') {
        const crop = crops.find(c => c.id === e.cropId);
        return crop ? `सर्व ${crop.name}` : '';
    }
    return '';
}

/** What the totals cover, in words: the whole farm, one crop, or one plot. */
export function pickLabel(crops: readonly CropProfile[], pick: BillPick): string {
    const crop = crops.find(c => c.id === pick.cropId);
    if (!crop) return 'सगळं शेत';
    const plot = crop.plots.find(p => p.id === pick.plotId);
    return plot ? `${plot.name} (${crop.name})` : `सर्व ${crop.name}`;
}
