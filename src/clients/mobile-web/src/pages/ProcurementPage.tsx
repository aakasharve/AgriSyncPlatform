
import React, { useState, useEffect } from 'react';
import { Package, Search, Camera, Plus } from 'lucide-react';
import SlidingCropSelector from '../features/context/components/SlidingCropSelector';
import { CropProfile, ProcurementExpense } from '../types';
import { procurementRepository } from '../services/procurementRepository';
import { ExpenseSummaryCards } from '../features/procurement/components/ExpenseSummaryCards';
import { ExpenseCard } from '../features/procurement/components/ExpenseCard';
import { ReceiptCaptureSheet } from '../features/procurement/components/ReceiptCaptureSheet';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters, MoneyCategory } from '../features/finance/finance.types';
import { financeCommandService } from '../features/finance/financeCommandService';

const mapExpenseCategoryToMoneyCategory = (category: string): MoneyCategory => {
    if (category === 'LABOUR') return 'Labour';
    if (category === 'FUEL') return 'Fuel';
    if (category === 'MACHINERY_RENTAL') return 'Machinery';
    if (category === 'TRANSPORT') return 'Transport';
    if (category === 'ELECTRICITY') return 'Electricity';
    if (category === 'EQUIPMENT_REPAIR') return 'Repair';
    if (['FERTILIZER', 'PESTICIDE', 'FUNGICIDE', 'SEEDS_PLANTS', 'IRRIGATION'].includes(category)) return 'Input';
    return 'Other';
};

interface Props {
    crops: CropProfile[];
}

const ProcurementPage: React.FC<Props> = ({ crops = [] }) => {
    // 1. Selection State
    const [selectedCropId, setSelectedCropId] = useState<string>(crops[0]?.id || '');
    const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);

    // 2. Data State
    const [expenses, setExpenses] = useState<ProcurementExpense[]>([]);
    const [showCaptureSheet, setShowCaptureSheet] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [lensOpen, setLensOpen] = useState(false);
    const [lensFilters, setLensFilters] = useState<FinanceFilters>({});

    // Load initial context
    useEffect(() => {
        const crop = crops.find(c => c.id === selectedCropId);
        if (crop && crop.plots.length > 0) {
            setSelectedPlotIds([crop.plots[0].id]);
        } else {
            setSelectedPlotIds([]);
        }
    }, [selectedCropId, crops]);

    const activePlotId = selectedPlotIds[0];
    const activeCrop = crops.find(c => c.id === selectedCropId);

    // Load Expenses
    const refreshData = () => {
        // For prototype: Load ALL and filter in UI or Load specific. 
        // Let's load all to calculate accurate stats per scope.
        const all = procurementRepository.getExpenses();
        all.forEach(expense => {
            expense.lineItems.forEach(item => {
                financeCommandService.createMoneyEventFromSource({
                    type: 'Procurement',
                    sourceId: `${expense.id}:${item.id}`,
                    dateTime: new Date(expense.date).toISOString(),
                    eventType: 'Expense',
                    category: mapExpenseCategoryToMoneyCategory(item.category),
                    plotId: expense.plotId,
                    cropId: expense.cropId,
                    amount: item.totalAmount,
                    qty: item.quantity,
                    unit: item.unit,
                    unitPrice: item.unitPrice,
                    paymentMode: expense.paymentStatus === 'CREDIT' ? 'Credit' : 'Cash',
                    vendorName: expense.vendorName
                });
            });
        });
        setExpenses(all);
    };

    useEffect(() => {
        refreshData();
    }, []);

    // Filter Logic
    const filteredExpenses = expenses.filter(e => {
        // Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const matchVendor = e.vendorName?.toLowerCase().includes(q);
            const matchItems = e.lineItems.some(i => i.name.toLowerCase().includes(q));
            if (!matchVendor && !matchItems) return false;
        }

        // Scope Filter:
        // - If Scope is FARM: Show always? Or only if no plot selected? 
        //   -> Decision: Show everything relevant to context + global.

        // Simpler for now: Show ALL, but highlighting context.
        // OR: Filter by standard logic:
        // if user selects Plot A -> Show Plot A + Crop Common + Farm Global

        if (activePlotId) {
            if (e.scope === 'FARM') return true;
            if (e.scope === 'CROP' && e.cropId === activeCrop?.id) return true;
            if (e.scope === 'PLOT' && e.plotId === activePlotId) return true;
            return false;
        }

        return true;
    });

    const summary = procurementRepository.getExpenseSummary();

    // --- RENDER ---
    return (
        <div className="pb-24 animate-in fade-in max-w-4xl mx-auto px-4 sm:px-6 py-6 font-sans">

            {/* 1. HEADER */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-stone-800 tracking-tight">Procurement</h1>
                    <p className="text-sm text-stone-500 font-medium">Expenses & Store Management</p>
                </div>
                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 shadow-md border border-orange-200">
                    <Package size={24} />
                </div>
            </div>

            {/* 2. SELECTOR */}
            <div className="mb-8">
                <SlidingCropSelector
                    crops={crops}
                    selectedCropId={selectedCropId}
                    selectedPlotIds={selectedPlotIds}
                    onCropSelect={setSelectedCropId}
                    onPlotSelect={(id) => setSelectedPlotIds([id])}
                    mode="single"
                />
            </div>

            {/* 3. SUMMARY CARDS */}
            <ExpenseSummaryCards summary={summary} />

            {/* 4. ACTIONS BAR */}
            <div className="flex gap-3 mb-6">
                <div className="flex-1 bg-white p-2 rounded-xl shadow-sm border border-stone-100 flex items-center gap-3 px-4">
                    <Search size={20} className="text-stone-300" />
                    <input
                        placeholder="Search receipts..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 bg-transparent outline-none text-sm font-bold text-stone-700 placeholder-stone-300"
                    />
                </div>
                <button
                    data-testid="scan-receipt-btn"
                    onClick={() => setShowCaptureSheet(true)}
                    className="flex-none bg-stone-800 text-white px-5 rounded-xl font-bold text-sm shadow-lg shadow-stone-200 flex items-center gap-2 active:scale-95 transition-all"
                >
                    <Camera size={18} /> Scan Receipt
                </button>
            </div>

            {/* 5. EXPENSE LIST */}
            <div className="space-y-4">
                {filteredExpenses.length === 0 ? (
                    <div className="bg-white border-2 border-dashed border-stone-200 rounded-3xl p-10 flex flex-col items-center justify-center text-center">
                        <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
                            <Package size={40} className="text-stone-300" />
                        </div>
                        <h3 className="text-xl font-bold text-stone-400 mb-2">No Receipts Found</h3>
                        <p className="text-sm text-stone-400 max-w-[240px] mb-8 leading-relaxed">
                            Upload a bill or receipt to start tracking expenses for {activeCrop?.name || "your farm"}.
                        </p>
                        <button
                            onClick={() => setShowCaptureSheet(true)}
                            className="bg-orange-500 text-white px-8 py-3 rounded-xl font-bold text-sm shadow-xl shadow-orange-200 flex items-center gap-2 active:scale-95 transition-all hover:bg-orange-600"
                        >
                            <Plus size={18} /> Add First Record
                        </button>
                    </div>
                ) : (
                    filteredExpenses.map(expense => (
                        <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            onClick={(e) => console.log('View', e)}
                            onMoneyClick={(expense) => {
                                setLensFilters({
                                    sourceType: 'Procurement',
                                    fromDate: expense.date,
                                    toDate: expense.date,
                                    plotId: expense.plotId,
                                    cropId: expense.cropId
                                });
                                setLensOpen(true);
                            }}
                        />
                    ))
                )}
            </div>

            {/* 6. MODALS */}
            {showCaptureSheet && (
                <ReceiptCaptureSheet
                    onClose={() => setShowCaptureSheet(false)}
                    onSave={() => {
                        refreshData();
                    }}
                    crops={crops}
                    activePlotId={activePlotId}
                />
            )}

            <MoneyLensDrawer
                isOpen={lensOpen}
                onClose={() => setLensOpen(false)}
                filters={lensFilters}
            />

        </div>
    );
};

export default ProcurementPage;
