import React, { useMemo, useState } from 'react';
import { AppRoute } from '../../types';
import { financeService } from './financeService';
import { financeCommandService } from './financeCommandService';
import { MoneyCategory } from './finance.types';
import { FinanceManagerNav } from './components/FinanceManagerNav';
import { getDateKey } from '../../core/domain/services/DateKeyService';

const CATEGORIES: MoneyCategory[] = ['Labour', 'Input', 'Machinery', 'Transport', 'Repair', 'Fuel', 'Electricity', 'Other'];

interface PriceBookPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const PriceBookPage: React.FC<PriceBookPageProps> = ({ currentRoute, onNavigate }) => {
    const [name, setName] = useState('');
    const [unit, setUnit] = useState('unit');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState<MoneyCategory>('Input');
    const [effectiveFrom, setEffectiveFrom] = useState(getDateKey());
    const [refresh, setRefresh] = useState(0);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: `refresh` and `currentRoute` are recompute triggers for the module-level financeService.getPriceBook store; the call itself takes no value deps.
    const items = useMemo(() => financeService.getPriceBook(), [refresh, currentRoute]);

    const addItem = () => {
        const parsedPrice = Number(price);
        if (!name.trim() || Number.isNaN(parsedPrice)) return;
        financeCommandService.createPriceBookItem({
            name: name.trim(),
            category,
            defaultUnit: unit.trim() || 'unit',
            defaultUnitPrice: parsedPrice,
            effectiveFrom,
            isActive: true
        });
        setName('');
        setPrice('');
        setRefresh(v => v + 1);
    };

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24">
            <h1 className="text-2xl font-black font-display text-stone-800">Price Book</h1>
            <p className="text-sm text-stone-500 mb-6">Prices moved out of Settings</p>
            <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />

            <div className="glass-panel p-5 mb-6">
                <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wide mb-3">Add New Price</h3>
                <div className="grid grid-cols-2 gap-3">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="rounded-xl border-transparent bg-surface-100 px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all placeholder:text-stone-400"
                        placeholder="Item name"
                    />
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as MoneyCategory)}
                        className="rounded-xl border-transparent bg-surface-100 px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-stone-700"
                    >
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <input
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        className="rounded-xl border-transparent bg-surface-100 px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all placeholder:text-stone-400"
                        placeholder="Unit (e.g., hr, kg)"
                    />
                    <input
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="rounded-xl border-transparent bg-surface-100 px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all placeholder:text-stone-400"
                        placeholder="Price"
                        type="number"
                    />
                    <div className="col-span-2">
                        <label className="text-xs text-stone-400 font-bold ml-1 mb-1 block">Effective Date</label>
                        <input
                            value={effectiveFrom}
                            onChange={(e) => setEffectiveFrom(e.target.value)}
                            className="w-full rounded-xl border-transparent bg-surface-100 px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-stone-700"
                            type="date"
                        />
                    </div>
                </div>
                <button
                    onClick={addItem}
                    className="mt-4 w-full rounded-xl bg-stone-900 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-stone-900/20 active:scale-[0.98] transition-all hover:bg-stone-800"
                >
                    Save Price
                </button>
            </div>

            <div className="space-y-3">
                {items.map(item => (
                    <div key={item.id} className="glass-panel p-4 flex items-center justify-between group hover:border-emerald-200 transition-colors">
                        <div>
                            <p className="font-bold text-stone-800 text-lg">{item.name}</p>
                            <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-stone-100 text-[10px] font-bold text-stone-500 uppercase tracking-wide">
                                {item.category}
                            </span>
                        </div>
                        <div className="text-right">
                            <p className="font-mono font-bold text-emerald-700 text-lg">
                                ₹{item.defaultUnitPrice.toLocaleString('en-IN')}
                            </p>
                            <p className="text-xs text-stone-400 font-medium">
                                per {item.defaultUnit}
                            </p>
                        </div>
                    </div>
                ))}
                {items.length === 0 && (
                    <div className="rounded-2xl border-2 border-dashed border-stone-200 p-8 text-center">
                        <p className="text-stone-400 font-medium">No prices configured yet.</p>
                        <p className="text-xs text-stone-300 mt-1">Add items above to track costs accurately.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceBookPage;
