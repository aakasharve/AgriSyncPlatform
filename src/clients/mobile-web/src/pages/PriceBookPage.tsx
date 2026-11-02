/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "दरपत्रक", the real Price Book in the
 * founder-approved look (PLR-D9 `FinanceTools.tsx`). Everything it had stays: every rate with its kind,
 * price, unit and from-date, and "नवीन दर" (kind, item, unit, price, from-date) saved through the SAME
 * `financeCommandService.createPriceBookItem` with the same fields — a blank unit is still stored as
 * `unit`. Added from the approved look: show one kind at a time, and "दर बदला" on a rate, which fills the
 * form so a NEW rate can be written from a new date. There is no in-place edit (the service has none);
 * the older rate stays listed, as a price book should.
 *
 * Said plainly, because it is true today (founder ruling D2 pending): a written rate is not kept. The
 * `set_price_config` payload is refused before it reaches the outbox, and the next read of the price book
 * replaces the list with the server's copy. So the page never says "saved" — it says the rate was written
 * and that keeping it is still to come. A price is required: a blank one used to be stored as ₹ 0.
 *
 * spec: plr-d10 lane F99 fix pass 1 (D-72) — the price list is ONE list for every farm, and only the platform admin may
 * write it (the server refuses anyone else, REST and push). So the write controls ("दर बदला", the "नवीन दर" form and its
 * "लवकरच" line) are shown only to the platform admin (`usePlatformAdmin`, fails closed); everyone else reads the list and
 * is told, in one line, that it is one list ShramSafal keeps (P5: no control that does nothing).
 */
import React, { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { AppRoute } from '../types';
import { financeService } from '../features/finance/financeService';
import { financeCommandService } from '../features/finance/financeCommandService';
import { MoneyCategory, PriceBookItem } from '../features/finance/finance.types';
import { getDateKey } from '../core/domain/services/DateKeyService';
import { MoneyPage } from '../features/finance/components/MoneyPage';
import { CATEGORY_LABEL, FINANCE_TITLE, MONEY_CATEGORIES, formatMoneyDate, rupees } from '../features/finance/moneyLabels';
import { BigButton, Chip, ChoiceChips, GlassCard, SectionHead, Soon, Tap, TextField } from '../shared/components/ui/placeUi';
import { usePlatformAdmin } from '../core/session/usePlatformAdmin';

interface PriceBookPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
}

const CATEGORY_CHIPS = MONEY_CATEGORIES.map(c => [c, CATEGORY_LABEL[c]] as const);
const SHOW_CHIPS = [['all', 'सर्व'] as const, ...CATEGORY_CHIPS];

/** What a stored placeholder means on screen: `unit` is "no unit given", `Price Config` is "no name sent". */
const unitShown = (unit: string) => (unit && unit !== 'unit' ? unit : '');
const nameShown = (name: string) => (name && name !== 'Price Config' ? name : 'नाव लिहिलेलं नाही');

const PriceBookPage: React.FC<PriceBookPageProps> = ({ currentRoute, onNavigate, onBack }) => {
    const [name, setName] = useState('');
    const [unit, setUnit] = useState('');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState<MoneyCategory>('Input');
    const [effectiveFrom, setEffectiveFrom] = useState(getDateKey());
    const [refresh, setRefresh] = useState(0);
    const [show, setShow] = useState<MoneyCategory | 'all'>('all');
    const [changing, setChanging] = useState<PriceBookItem | null>(null);
    const [written, setWritten] = useState(false);
    const mayWritePrices = usePlatformAdmin();

    // `refresh` and `currentRoute` are re-read triggers: the service reads a mutable store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const items = useMemo(() => financeService.getPriceBook(), [refresh, currentRoute]);
    const list = items.filter(item => show === 'all' || item.category === show);

    const parsedPrice = Number(price);
    const canSave = name.trim() !== '' && price.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice > 0;

    const resetForm = () => {
        setName('');
        setPrice('');
        setUnit('');
        setChanging(null);
    };

    const addItem = () => {
        if (!canSave) return;
        financeCommandService.createPriceBookItem({
            name: name.trim(),
            category,
            defaultUnit: unit.trim() || 'unit',
            defaultUnitPrice: parsedPrice,
            effectiveFrom,
            isActive: true
        });
        resetForm();
        setWritten(true);
        setShow('all');
        setRefresh(v => v + 1);
    };

    const startChange = (item: PriceBookItem) => {
        setChanging(item);
        setName(item.name === 'Price Config' ? '' : item.name);
        setCategory(item.category);
        setUnit(unitShown(item.defaultUnit));
        setPrice(String(item.defaultUnitPrice));
        setEffectiveFrom(getDateKey());
        setWritten(false);
        if (typeof document !== 'undefined') {
            document.getElementById('price-form')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        }
    };

    return (
        <MoneyPage title={FINANCE_TITLE['finance-price-book']} testId="fin-prices" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack}>
            {mayWritePrices ? (
                <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">ठरलेले दर इथे एकदा लिहून ठेवा — मजुरी, खत-औषध, यंत्र, इंधन.</p>
            ) : (
                // PROPOSED words (lane F99 fix pass 1, D-72).
                <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700" data-testid="price-read-only">
                    हे दरपत्रक सगळ्या शेतांसाठी एकच आहे. ते फक्त श्रमसफल बदलू शकतं.
                </p>
            )}

            <ChoiceChips items={SHOW_CHIPS} value={show} onPick={setShow} testId="price-show" />

            {list.map(item => (
                <GlassCard key={item.id} testId={`price-row-${item.id}`}>
                    <div className="flex items-baseline justify-between gap-2">
                        <p className="m-0 min-w-0 text-[15.5px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{nameShown(item.name)}</p>
                        <p className="m-0 shrink-0 text-[16px] font-extrabold text-stone-900">
                            {rupees(item.defaultUnitPrice)}
                            {unitShown(item.defaultUnit) && <span className="text-[13px] font-bold text-stone-500"> / {unitShown(item.defaultUnit)}</span>}
                        </p>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <Chip tone="violet">{CATEGORY_LABEL[item.category]}</Chip>
                        {formatMoneyDate(item.effectiveFrom) && <span className="text-[12.5px] font-bold text-stone-500">{formatMoneyDate(item.effectiveFrom)} पासून</span>}
                        {mayWritePrices && (
                            <Tap onClick={() => startChange(item)} data-testid={`price-change-${item.id}`}
                                className="flex min-h-[40px] items-center gap-1 rounded-full bg-white px-3 text-[13.5px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">
                                <Pencil size={14} aria-hidden="true" />दर बदला
                            </Tap>
                        )}
                    </div>
                </GlassCard>
            ))}
            {list.length === 0 && (
                <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[14px] font-bold text-stone-500" data-testid="price-empty">
                    {items.length === 0 ? 'अजून एकही दर लिहिलेला नाही.' : 'या प्रकारचा दर अजून लिहिलेला नाही.'}
                </p>
            )}

            {mayWritePrices && <div id="price-form" className="space-y-3">
                <SectionHead
                    title={changing ? `दर बदला — ${nameShown(changing.name)}` : 'नवीन दर'}
                    hint={changing ? 'नवा दर आणि तो कधीपासून ते लिहा. आधीचा दर यादीत तसाच राहील.' : 'प्रकार निवडा, मग नाव, दर आणि कधीपासून'}
                />
                <GlassCard testId="price-form">
                    <ChoiceChips items={CATEGORY_CHIPS} value={category} onPick={setCategory} testId="price-cat" />
                    <div className="mt-3 space-y-2">
                        <TextField label="कशाचा दर?" value={name} onChange={v => { setName(v); setWritten(false); }} placeholder="उदा. फवारणी मजूर" testId="price-item" />
                        <div className="grid grid-cols-2 gap-2">
                            <TextField label="दर (₹)" type="number" value={price} onChange={v => { setPrice(v); setWritten(false); }} testId="price-rate" />
                            <TextField label="कशामागे?" value={unit} onChange={setUnit} placeholder="दिवस, किलो" testId="price-unit" />
                        </div>
                        <label className="block">
                            <span className="text-[13.5px] font-extrabold text-stone-700">कधीपासून</span>
                            <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} data-testid="price-date"
                                className="mt-1 min-h-[52px] w-full rounded-xl bg-white px-3 text-[17px] font-bold text-stone-900 outline-none ring-1 ring-stone-300 focus:ring-2 focus:ring-emerald-500" />
                        </label>
                        <BigButton onClick={addItem} disabled={!canSave} testId="price-save"><Plus size={20} aria-hidden="true" />दर यादीत लिहा</BigButton>
                        {changing && (
                            <Tap onClick={resetForm} data-testid="price-change-cancel"
                                className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-white text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-300">
                                रद्द करा
                            </Tap>
                        )}
                        {written && (
                            <p className="m-0 text-center text-[14px] font-extrabold text-emerald-800" role="status" data-testid="price-written">
                                दर यादीत लिहिला ✓ — पण अजून कायम जतन होत नाही.
                            </p>
                        )}
                    </div>
                </GlassCard>
                <Soon what="लिहिलेला दर कायम जतन होणं आणि शेतातल्या इतर फोनवर दिसणं" />
            </div>}
        </MoneyPage>
    );
};

export default PriceBookPage;
