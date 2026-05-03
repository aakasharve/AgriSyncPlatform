/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
    FarmContext,
    CropProfile
} from '../types';
import {
    HarvestSession,
    HarvestConfig,
    OtherIncomeEntry
} from '../features/logs/harvest.types';
import {
    Plus,
    TrendingUp,
    AlertCircle,
    ChevronRight,
    Calendar,
    Archive,
    DollarSign, // Kept for safety, though unused in new design
    Pencil
} from 'lucide-react';
import { getHarvestSessions, getHarvestConfig, startHarvestSession, getOtherIncomeEntries } from '../services/harvestService';
import SlidingCropSelector from '../features/context/components/SlidingCropSelector';
import HarvestConfigSheet from '../features/logs/components/harvest/HarvestConfigSheet';
import GradeWiseEntrySheet from '../features/logs/components/harvest/GradeWiseEntrySheet';
import PattiUploadSheet from '../features/logs/components/harvest/PattiUploadSheet';
import PendingHarvestBanner from '../features/logs/components/harvest/PendingHarvestBanner';
import OtherIncomeSheet from '../features/logs/components/harvest/OtherIncomeSheet';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';

interface HarvestIncomePageProps {
    context: FarmContext | null;
    crops: CropProfile[];
    onBack: () => void;
}

const HarvestIncomePage: React.FC<HarvestIncomePageProps> = ({ context, crops, onBack: _onBack }) => {
    // Selection State
    const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
    const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);

    // Data State
    const [sessions, setSessions] = useState<HarvestSession[]>([]);
    const [config, setConfig] = useState<HarvestConfig | null>(null);

    // UI State
    const [showConfigSheet, setShowConfigSheet] = useState(false);
    const [showEntrySheet, setShowEntrySheet] = useState(false);
    const [showPattiUpload, setShowPattiUpload] = useState(false);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    const [extractedPattiData, setExtractedPattiData] = useState<any>(null);

    // Other Income State
    const [showOtherIncomeSheet, setShowOtherIncomeSheet] = useState(false);
    const [reloadOtherIncomeCounter, setReloadOtherIncomeCounter] = useState(0);
    const [otherIncome, setOtherIncome] = useState<OtherIncomeEntry[]>([]);
    const [lensOpen, setLensOpen] = useState(false);
    const [lensFilters, setLensFilters] = useState<FinanceFilters>({});

    // Initialize Selection
    useEffect(() => {
        if (context && context.selection.length > 0 && context.selection[0].cropId !== 'FARM_GLOBAL') {
            const cropId = context.selection[0].cropId;
            const plotId = context.selection[0].selectedPlotIds[0];
            setSelectedCropId(cropId);
            const crop = crops.find(c => c.id === cropId);
            if (crop && plotId) setSelectedPlotId(plotId);
            else if (crop && crop.plots.length > 0) setSelectedPlotId(crop.plots[0].id);
        } else if (crops.length > 0) {
            setSelectedCropId(crops[0].id);
            if (crops[0].plots.length > 0) setSelectedPlotId(crops[0].plots[0].id);
        }
    }, [context, crops]);

    // Load Data
    useEffect(() => {
        if (selectedPlotId && selectedCropId) {
            const loadedConfig = getHarvestConfig(selectedPlotId);
            setConfig(loadedConfig);
            const loadedSessions = getHarvestSessions(selectedPlotId, selectedCropId);
            setSessions(loadedSessions);
        }
    }, [selectedPlotId, selectedCropId, showConfigSheet, showEntrySheet]);

    // Load Other Income
    useEffect(() => {
        setOtherIncome(getOtherIncomeEntries());
    }, [reloadOtherIncomeCounter]);

    // Calculations
    const sessionIncome = sessions.reduce((sum, s) => sum + s.totalIncome, 0);
    const otherIncomeTotal = otherIncome.reduce((sum, o) => sum + o.amount, 0);
    const totalInHandIncome = sessionIncome + otherIncomeTotal;
    const pendingAmount = sessions.reduce((sum, s) => sum + s.amountPending, 0);
    const activeCrop = crops.find(c => c.id === selectedCropId);
    const activePlot = activeCrop?.plots.find(p => p.id === selectedPlotId);

    // Handlers
    const handleStartHarvest = () => {
        if (!config || !selectedPlotId || !selectedCropId) return;
        const active = sessions.find(s => s.status === 'IN_PROGRESS');
        if (active) {
            setSelectedSessionId(active.id);
            setShowPattiUpload(true);
        } else {
            const newSession = startHarvestSession(selectedPlotId, selectedCropId, config);
            setSelectedSessionId(newSession.id);
            setSessions(getHarvestSessions(selectedPlotId, selectedCropId));
            setShowPattiUpload(true);
        }
    };

    const handleSessionClick = (session: HarvestSession) => {
        setSelectedSessionId(session.id);
        if (session.status === 'SOLD') setShowEntrySheet(true);
        else setShowPattiUpload(true);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    const handlePattiSuccess = (data: any) => {
        setExtractedPattiData(data);
        setShowPattiUpload(false);
        setShowEntrySheet(true);
    };

    const handlePattiSkip = () => {
        setExtractedPattiData(null);
        setShowPattiUpload(false);
        setShowEntrySheet(true);
    };

    const handleEntrySaved = (updatedSession: HarvestSession) => {
        setSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
        setShowEntrySheet(false);
    };

    const handlePendingAction = (session: HarvestSession, _action: 'SALE_ENTRY' | 'PAYMENT_ENTRY') => {
        setSelectedSessionId(session.id);
        setShowEntrySheet(true); // Simplified for now
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-24">

            {/* Main Content Container with Animation */}
            <div className="p-4 space-y-6 pt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

                {/* Hero Title (Replaces Header) */}
                <div className="flex flex-col gap-1 px-1">
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight">Harvest & Income</h1>
                    <p className="text-slate-500 font-medium">Manage your yield and earnings</p>
                </div>

                {/* Crop Selector - Static (Log Page Logic) */}
                <div className="z-10 -mx-2 px-2 pb-2 pt-2 bg-slate-50 transition-all">
                    <SlidingCropSelector
                        crops={crops}
                        selectedCropId={selectedCropId}
                        onSelect={(id) => {
                            setSelectedCropId(id);
                            const crop = crops.find(c => c.id === id);
                            if (crop && crop.plots.length > 0) setSelectedPlotId(crop.plots[0].id);
                        }}
                        selectedPlotIds={selectedPlotId ? [selectedPlotId] : []}
                        onPlotSelect={(id) => setSelectedPlotId(id)}
                    />
                </div>

                {/* Pending Actions Banner - Floating Alert */}
                <PendingHarvestBanner
                    sessions={sessions}
                    onAction={handlePendingAction}
                />

                {/* Summary Cards - Glass Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="glass-panel-dark bg-emerald-900 border-emerald-800 p-5 rounded-3xl relative overflow-hidden group">
                        {/* Background Decor */}
                        <div className="absolute -right-4 -top-4 opacity-10 rotate-12 group-hover:rotate-0 transition-transform duration-700">
                            <DollarSign size={80} />
                        </div>

                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-3 text-emerald-300">
                                <TrendingUp size={18} />
                                <span className="text-xs font-black uppercase tracking-widest">In Hand Income</span>
                            </div>
                            <div className="text-2xl font-black text-white tracking-tight">₹{(totalInHandIncome / 100000).toFixed(2)}L</div>
                            <div className="text-xs text-emerald-400 mt-1 font-medium">₹{totalInHandIncome.toLocaleString()}</div>
                            <div className="mt-2">
                                <MoneyChip
                                    amount={totalInHandIncome}
                                    onClick={() => {
                                        setLensFilters({
                                            type: 'Income',
                                            cropId: selectedCropId || undefined,
                                            plotId: selectedPlotId || undefined
                                        });
                                        setLensOpen(true);
                                    }}
                                    className="border-emerald-300 bg-emerald-100 text-emerald-900"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel p-5 rounded-3xl relative overflow-hidden group border-rose-100">
                        {/* Background Decor */}
                        <div className="absolute -right-4 -top-4 opacity-[0.03] text-rose-500 rotate-12 group-hover:rotate-0 transition-transform duration-700">
                            <AlertCircle size={80} />
                        </div>

                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-3 text-rose-500">
                                <AlertCircle size={18} />
                                <span className="text-xs font-black uppercase tracking-widest">Pending</span>
                            </div>
                            <div className="text-2xl font-black text-slate-800 tracking-tight">₹{(pendingAmount / 1000).toFixed(1)}k</div>
                            <div className="text-xs text-slate-400 mt-1 font-medium">From {sessions.filter(s => s.paymentStatus === 'PENDING').length} sources</div>
                            <div className="mt-2">
                                <MoneyChip
                                    amount={pendingAmount}
                                    onClick={() => {
                                        setLensFilters({
                                            type: 'Income',
                                            trustStatus: 'Unverified',
                                            cropId: selectedCropId || undefined,
                                            plotId: selectedPlotId || undefined
                                        });
                                        setLensOpen(true);
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Action: Start Harvest or Configure Banner */}
                {!config ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                        <AlertCircle size={20} className="text-amber-500 mt-0.5 shrink-0" />
                        <div className="flex-1">
                            <p className="text-sm font-bold text-amber-800">Harvest not configured for this plot</p>
                            <p className="text-xs text-amber-600 mt-0.5">Set up pattern & units in Settings, or configure now.</p>
                        </div>
                        <button
                            onClick={() => {
                                if (activePlot && activeCrop) setShowConfigSheet(true);
                            }}
                            className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                        >
                            Configure Now
                        </button>
                    </div>
                ) : (
                    <div className="glass-panel rounded-3xl border border-emerald-100/50 shadow-lg shadow-emerald-500/5 active:scale-[0.98] transition-all duration-300 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500"></div>

                        <div className="flex items-center gap-5 p-6">
                            <button
                                onClick={handleStartHarvest}
                                className="flex items-center gap-5 flex-1 text-left group outline-none"
                                aria-label="Log New Harvest"
                            >
                                <div className="w-16 h-16 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform duration-300">
                                    <Plus size={32} strokeWidth={3} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-slate-800 group-hover:text-emerald-700 transition-colors">
                                        Log New Harvest
                                    </h3>
                                    <p className="text-sm text-slate-500 font-medium mt-0.5">
                                        Record picking for {activePlot?.name}
                                    </p>
                                </div>
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowConfigSheet(true);
                                }}
                                className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors shrink-0"
                                aria-label="Edit harvest configuration"
                            >
                                <Pencil size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Session List */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="font-bold text-slate-400 uppercase tracking-widest text-xs flex items-center gap-2">
                            <Archive size={14} />
                            Recent History
                        </h3>
                    </div>

                    {sessions.length === 0 ? (
                        <div className="text-center py-12 glass-panel border-dashed border-slate-200/60 rounded-3xl">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-300">
                                <Calendar size={32} />
                            </div>
                            <p className="text-slate-400 font-bold">No harvest records yet</p>
                            <p className="text-xs text-slate-300 mt-1">Start harvesting to track yield</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {sessions.map(session => (
                                <button
                                    key={session.id}
                                    onClick={() => handleSessionClick(session)}
                                    className="w-full glass-panel p-4 rounded-2xl flex items-center justify-between hover:bg-white/80 active:scale-[0.99] transition-all group"
                                >
                                    <div className="text-left flex items-center gap-4">
                                        {/* Status Indicator Icon */}
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black shadow-sm ${session.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-600' :
                                            session.status === 'SOLD' ? 'bg-emerald-100 text-emerald-600' :
                                                'bg-slate-100 text-slate-500'
                                            }`}>
                                            {session.status === 'IN_PROGRESS' ? '⏱' :
                                                session.status === 'SOLD' ? '💰' : '📦'}
                                        </div>

                                        <div>
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <div className="font-black text-slate-800 text-lg">
                                                    {session.totalQuantitySent} <span className="text-sm font-bold text-slate-500">{session.unit.type === 'WEIGHT' ? session.unit.weightUnit : session.unit.containerName}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs font-bold">
                                                <span className={`px-2 py-0.5 rounded-md ${session.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-600' :
                                                    'bg-slate-100 text-slate-500'
                                                    }`}>
                                                    {session.status === 'IN_PROGRESS' ? 'Ongoing' : new Date(session.startDate).toLocaleDateString()}
                                                </span>
                                                {session.totalIncome > 0 && (
                                                    <span className="text-emerald-600">
                                                        ₹{session.totalIncome.toLocaleString()}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <ChevronRight size={20} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* OTHER INCOME SECTION */}
                <div className="pt-6 border-t border-slate-200/60">
                    <div className="flex items-center justify-between mb-4 px-1">
                        <h3 className="font-bold text-slate-400 uppercase tracking-widest text-xs">Other Income</h3>
                        <button
                            onClick={() => setShowOtherIncomeSheet(true)}
                            className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 active:scale-95 transition-all"
                        >
                            + Add Custom
                        </button>
                    </div>

                    {otherIncome.length === 0 ? (
                        <div className="text-center p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                            <p className="text-xs font-bold text-slate-400">Scrap, Subsidies, Rent...</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {otherIncome.map(inc => (
                                <div key={inc.id} className="bg-white/60 p-3 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center font-bold text-sm shadow-sm">
                                            {inc.source[0]}
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-700">{inc.description}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{new Date(inc.date).toLocaleDateString()} • {inc.source}</p>
                                        </div>
                                    </div>
                                    <span className="font-black text-emerald-600">+₹{inc.amount.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Sheets */}
            {showConfigSheet && activePlot && activeCrop && (
                <HarvestConfigSheet
                    plotId={activePlot.id}
                    crop={activeCrop}
                    onClose={() => setShowConfigSheet(false)}
                    onConfigSaved={(c) => {
                        setConfig(c);
                        setShowConfigSheet(false);
                    }}
                />
            )}

            {showEntrySheet && selectedSessionId && (
                <GradeWiseEntrySheet
                    session={sessions.find(s => s.id === selectedSessionId)!}
                    onClose={() => setShowEntrySheet(false)}
                    onSave={handleEntrySaved}
                    initialData={extractedPattiData}
                />
            )}

            {showPattiUpload && selectedSessionId && activeCrop && (
                <PattiUploadSheet
                    session={sessions.find(s => s.id === selectedSessionId)!}
                    cropName={activeCrop.name}
                    onClose={handlePattiSkip}
                    onDataExtracted={handlePattiSuccess}
                />
            )}

            {showOtherIncomeSheet && (
                <OtherIncomeSheet
                    crops={crops}
                    onClose={() => setShowOtherIncomeSheet(false)}
                    onSave={() => {
                        setReloadOtherIncomeCounter(prev => prev + 1);
                        setShowOtherIncomeSheet(false);
                    }}
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

export default HarvestIncomePage;
