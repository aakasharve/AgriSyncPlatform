/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LedgerDefaults, FarmerProfile, Plot } from '../../../../../types';
import { AlertTriangle, User, Users, Droplets, Tractor, X } from 'lucide-react';
import Button from '../../../../../shared/components/ui/Button';
import IssueFormSheet from '../../IssueFormSheet';

/**
 * One sheet serves labour, irrigation AND machinery: `data` arrives as whichever
 * event shape matches `type`, and `localData` accumulates fields from all three
 * as the farmer switches tabs. Typing that honestly means splitting this
 * component per type — a real refactor, not a rename — so the looseness is
 * named once here instead of being repeated at six call sites.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DetailData = any;

const DetailSheet = ({
    type,
    data,
    defaults,
    onSave,
    onClose,
    profile,
    currentPlot,
    cropContractUnit
}: {
    type: 'labour' | 'irrigation' | 'machinery',
    data: DetailData,
    defaults: LedgerDefaults,
    onSave: (d: DetailData) => void,
    onClose: () => void,
    profile: FarmerProfile,
    currentPlot?: Plot,
    cropContractUnit?: string
}) => {
    // SYNCHRONOUS INITIALIZATION (Prevents empty flash)
    const [localData, setLocalData] = useState<DetailData>(() => {
        // If editing existing data, use it
        if (data && Object.keys(data).length > 0) return { ...data };

        // Otherwise, generate smart defaults immediately
        if (type === 'labour') {
            const defaultShift = defaults.labour.shifts.find(s => s.name === 'Full Day') || defaults.labour.shifts[0];
            // Labour V1 final fix (C2) — NO PRE-SEEDED NUMBERS.
            //
            // This used to open with maleCount/femaleCount/count/totalCost all
            // set to 0. Those were form defaults, not farmer statements, and
            // they did not stay in the form: `buildLabourPayloads` sends any
            // finite/integer value INCLUDING 0, the server preserves NULL only
            // when all three headcounts are null, and `LabourAssignment`'s
            // TotalCost is documented as "NULL when not stated… never
            // computed". So a contract engagement where the farmer stated a
            // quantity but never a total was recording "₹0 was stated" instead
            // of "we were not told" — a constant wearing the costume of a
            // measurement, in the canonical record, with no backfill job in
            // this system to undo it.
            //
            // Absence is the honest initial state and it costs nothing to
            // display: every one of these fields reaches the DOM through
            // `value={x || ''}`, which renders 0 and undefined identically
            // (measured: the sheet's outerHTML is byte-identical either way at
            // 412/628/1400). The `parseFloat(...) || 0` handlers below then put
            // a real number here the moment the farmer types one — including a
            // genuine 0, which is data and must survive.
            //
            // `type` and `shiftId` are NOT the same case: both are visibly
            // reflected in the UI (the selected tab, the highlighted shift
            // chip), so they are shown defaults the farmer can see and change,
            // not silent claims about a quantity.
            return {
                type: 'HIRED',
                shiftId: defaultShift?.id
            };
        }
        if (type === 'irrigation') {
            // Updated to use Infrastructure for Method/Motor
            const infra = currentPlot?.infrastructure;
            const plotMethod = infra?.irrigationMethod || currentPlot?.irrigationPlan?.method || defaults.irrigation.method;
            const plotMotorId = infra?.linkedMotorId || currentPlot?.irrigationPlan?.motorId;
            const linkedSource = plotMotorId
                ? profile.waterResources.find(w => w.id === profile.motors.find(m => m.id === plotMotorId)?.linkedWaterSourceId)?.name
                : 'Well';

            return {
                method: plotMethod === 'None' ? 'Drip' : plotMethod,
                source: linkedSource || 'Well',
                motorId: plotMotorId || '',
                durationHours: currentPlot?.irrigationPlan?.durationMinutes ? currentPlot.irrigationPlan.durationMinutes / 60 : defaults.irrigation.defaultDuration
            };
        }
        if (type === 'machinery') {
            return { type: 'tractor', hoursUsed: 1 };
        }
        return {};
    });

    const [labourTab, setLabourTab] = useState<'HIRED' | 'CONTRACT' | 'SELF'>(localData.type || 'HIRED');
    // Removed legacy irrigationIssue state - now using BucketIssue object type

    // NEW: Issue Sheet State (Replaces inline form)
    const [showIssueSheet, setShowIssueSheet] = useState(false);

    // LABOUR LOGIC
    const handleShiftSelect = (shiftId: string) => {
        setLocalData((prev: DetailData) => ({ ...prev, shiftId }));
    };

    // Auto-calculate total cost whenever counts or shift changes
    useEffect(() => {
        if (type === 'labour' && localData.type === 'HIRED' && localData.shiftId) {
            const shift = defaults.labour.shifts.find(s => s.id === localData.shiftId);
            // Labour V1 final fix (C2) — DERIVE FROM A STATEMENT, NEVER FROM
            // SILENCE. This effect fires on mount (a shift is pre-selected), so
            // without this guard it immediately wrote `totalCost: 0, count: 0`
            // over the initializer and put the fabricated zeros straight back —
            // removing them above would have achieved nothing. A total derived
            // from no headcount at all is not a cheaper total, it is a number
            // nobody said. Once EITHER split carries a number the arithmetic is
            // exactly as before, so the "Total Paid (Auto)" box still fills in
            // on the first keystroke.
            const hasStatedSplit = typeof localData.maleCount === 'number'
                || typeof localData.femaleCount === 'number';
            if (shift && hasStatedSplit) {
                const mCost = (localData.maleCount || 0) * (shift.defaultRateMale || 0);
                const fCost = (localData.femaleCount || 0) * (shift.defaultRateFemale || 0);
                const total = mCost + fCost;

                // Update total cost AND total count
                setLocalData((prev: DetailData) => ({
                    ...prev,
                    totalCost: total,
                    count: (prev.maleCount || 0) + (prev.femaleCount || 0)
                }));
            }
        }
        // `type` is fixed for the lifetime of a mounted sheet, and
        // `defaults.labour.shifts` is a fresh array identity on most parent
        // renders — adding either would re-run an effect that calls
        // setLocalData, i.e. trade a lint warning for a render loop. The
        // effect intentionally keys only on the values it recomputes from.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localData.maleCount, localData.femaleCount, localData.shiftId, localData.type]);

    const handleContractUnitInit = () => {
        if (!localData.contractUnit) {
            // Apply Dynamic Defaults from Plot/Crop
            const unit = cropContractUnit || 'Acre';
            // Same fabrication as the initializer above, one branch further in:
            // when the plot carries no baseline to derive a quantity from, this
            // used to fall through to a literal 0 and record "0 acres were
            // contracted". A quantity that can be derived from the plot is a
            // real starting figure the farmer sees and can overwrite; when
            // there is none, the honest value is nothing at all.
            let quantity: number | undefined;
            if (unit === 'Tree' && currentPlot?.baseline.totalPlants) quantity = currentPlot.baseline.totalPlants;
            else if (unit === 'Acre' && currentPlot?.baseline.totalArea) quantity = currentPlot.baseline.totalArea;

            setLocalData({ ...localData, type: 'CONTRACT', contractUnit: unit, contractQuantity: quantity });
        } else {
            setLocalData({ ...localData, type: 'CONTRACT' });
        }
    };

    // Render using Portal to escape parent stacking contexts (Fixes "Blank Glass" issue)
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* Sheet */}
            <div className="bg-white w-full max-w-lg p-5 rounded-t-3xl shadow-2xl relative z-10 animate-in slide-in-from-bottom-full duration-300">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <h3 className="font-bold text-lg capitalize flex items-center gap-2 text-slate-800">
                        {type === 'labour' && <Users size={20} className="text-orange-500" />}
                        {type === 'irrigation' && <Droplets size={20} className="text-blue-500" />}
                        {type === 'machinery' && <Tractor size={20} className="text-slate-500" />}
                        {type === 'labour' ? 'Labour Details' : type === 'irrigation' ? 'Daily Irrigation' : 'Machinery Usage'}
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Issue Button */}
                        <button
                            onClick={() => setShowIssueSheet(true)}
                            className={`p-2 rounded-full transition-colors ${localData.issue
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-slate-100 text-slate-400 hover:text-amber-600'
                                }`}
                        >
                            <AlertTriangle size={20} />
                        </button>
                        <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={18} /></button>
                    </div>
                </div>

                <div className="space-y-5 mb-6 max-h-[60vh] overflow-y-auto px-1">

                    {/* --- LABOUR FORM --- */}
                    {type === 'labour' && (
                        <>
                            {/* 1. Labour Type Tabs */}
                            <div className="flex p-1 bg-slate-100 rounded-xl">
                                {['HIRED', 'CONTRACT', 'SELF'].map(t => (
                                    <button
                                        key={t}
                                        onClick={() => {
                                            setLabourTab(t as 'HIRED' | 'CONTRACT' | 'SELF');
                                            if (t === 'CONTRACT') handleContractUnitInit();
                                            else setLocalData({ ...localData, type: t });
                                        }}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${labourTab === t ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-600'
                                            }`}
                                    >
                                        {t === 'HIRED' ? 'Daily Wage' : t === 'CONTRACT' ? 'Contract' : 'Self'}
                                    </button>
                                ))}
                            </div>

                            {/* Add Issue Button - REMOVED (Moved to Header) */}
                            {/* Issue Form (Collapsible) - REMOVED (Replaced by IssueFormSheet) */}

                            {/* 2. Content based on Tab */}
                            {labourTab === 'HIRED' && (
                                <div className="space-y-4 animate-in fade-in">
                                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                        {defaults.labour.shifts.map(shift => (
                                            <button
                                                key={shift.id}
                                                onClick={() => handleShiftSelect(shift.id)}
                                                className={`px-4 py-2.5 rounded-xl border text-xs font-bold whitespace-nowrap transition-all ${localData.shiftId === shift.id ? 'bg-orange-50 border-orange-200 text-orange-800 ring-2 ring-orange-100' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                            >
                                                {shift.name}
                                            </button>
                                        ))}
                                    </div>

                                    {/* 3. Counts with Validation */}
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Total Labours</label>
                                            <input
                                                type="number"
                                                className="w-full p-3 border border-slate-200 rounded-xl font-bold text-lg mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none"
                                                value={localData.count || ''}
                                                placeholder="0"
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    setLocalData({ ...localData, count: val });
                                                }}
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Male Split</label>
                                                <input
                                                    type="number"
                                                    className={`w-full p-3 border rounded-xl font-bold text-lg mt-1 focus:ring-2 outline-none ${localData.count && (localData.maleCount || 0) + (localData.femaleCount || 0) !== localData.count
                                                        ? 'border-amber-300 bg-amber-50 focus:ring-amber-500/20'
                                                        : 'border-slate-200 focus:ring-orange-500/20 focus:border-orange-500'
                                                        }`}
                                                    value={localData.maleCount || ''}
                                                    placeholder="0"
                                                    onChange={e => setLocalData({ ...localData, maleCount: parseFloat(e.target.value) || 0 })}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Female Split</label>
                                                <input
                                                    type="number"
                                                    className={`w-full p-3 border rounded-xl font-bold text-lg mt-1 focus:ring-2 outline-none ${localData.count && (localData.maleCount || 0) + (localData.femaleCount || 0) !== localData.count
                                                        ? 'border-amber-300 bg-amber-50 focus:ring-amber-500/20'
                                                        : 'border-slate-200 focus:ring-orange-500/20 focus:border-orange-500'
                                                        }`}
                                                    value={localData.femaleCount || ''}
                                                    placeholder="0"
                                                    onChange={e => setLocalData({ ...localData, femaleCount: parseFloat(e.target.value) || 0 })}
                                                />
                                            </div>
                                        </div>

                                        {localData.count && (localData.maleCount || 0) + (localData.femaleCount || 0) > 0 &&
                                            (localData.maleCount || 0) + (localData.femaleCount || 0) !== localData.count && (
                                                <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                                    <AlertTriangle size={10} />
                                                    Split ({(localData.maleCount || 0) + (localData.femaleCount || 0)}) doesn't match Total ({localData.count})
                                                </p>
                                            )}
                                    </div>

                                    {/* 4. Stated Hours (Labour V1 Task 7.4)
                                        The first REAL producer of duration in the app: a number the
                                        farmer states, not one the app assumes. Optional by
                                        construction — clearing the field, typing "0", or any stray
                                        keystroke stores `undefined`, i.e. "not stated", which the
                                        server records as its own assumed default. It can never
                                        reject or block the day's log. */}
                                    <div>
                                        <label
                                            className="text-xs font-bold text-slate-400 uppercase"
                                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                        >
                                            कामाचे तास
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full p-3 border border-slate-200 rounded-xl font-bold text-lg mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none"
                                            value={localData.durationHours ?? ''}
                                            placeholder="0"
                                            onChange={e => {
                                                const n = parseFloat(e.target.value);
                                                setLocalData({ ...localData, durationHours: Number.isFinite(n) && n > 0 ? n : undefined });
                                            }}
                                        />
                                    </div>

                                    {/* Auto-Calculated Total */}
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center">
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">Total Paid (Auto)</p>
                                            <p className="text-xs text-slate-500 mt-0.5">Based on shift rates</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-lg font-bold text-slate-400">₹</span>
                                            <input
                                                type="number"
                                                className="bg-transparent font-mono text-2xl font-bold text-slate-800 outline-none w-32 text-right"
                                                value={localData.totalCost || ''}
                                                onChange={e => setLocalData({ ...localData, totalCost: parseFloat(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {labourTab === 'CONTRACT' && (
                                <div className="space-y-4 animate-in fade-in">
                                    <div className="flex gap-2">
                                        <div className="w-1/3">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Unit</label>
                                            <select
                                                className="w-full p-3 border border-slate-200 rounded-xl mt-1 bg-white text-sm font-bold focus:ring-2 focus:ring-orange-500/20 outline-none"
                                                value={localData.contractUnit || 'Acre'}
                                                onChange={e => setLocalData({ ...localData, contractUnit: e.target.value })}
                                            >
                                                <option value="Tree">Per Tree</option>
                                                <option value="Acre">Per Acre</option>
                                                <option value="Row">Per Row</option>
                                                <option value="Lump Sum">Lump Sum</option>
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Quantity</label>
                                            <input
                                                type="number"
                                                className="w-full p-3 border border-slate-200 rounded-xl mt-1 focus:ring-2 focus:ring-orange-500/20 outline-none"
                                                value={localData.contractQuantity || ''}
                                                placeholder={localData.contractUnit === 'Tree' ? 'No. of Trees' : 'Qty'}
                                                onChange={e => setLocalData({ ...localData, contractQuantity: parseFloat(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Total Contract Amount (₹)</label>
                                        <input
                                            type="number"
                                            className="w-full p-3 border border-slate-200 rounded-xl mt-1 font-bold text-lg focus:ring-2 focus:ring-orange-500/20 outline-none"
                                            value={localData.totalCost || ''}
                                            placeholder="0"
                                            onChange={e => setLocalData({ ...localData, totalCost: parseFloat(e.target.value) })}
                                        />
                                    </div>
                                </div>
                            )}

                            {labourTab === 'SELF' && (
                                <div className="animate-in fade-in bg-slate-50 p-6 rounded-xl border border-slate-200 text-center">
                                    <User size={32} className="mx-auto text-slate-400 mb-2" />
                                    <p className="text-sm font-bold text-slate-600">Self / Family Labour</p>
                                    <p className="text-xs text-slate-400 mt-1">No cost will be recorded for this activity.</p>
                                </div>
                            )}
                        </>
                    )}

                    {/* --- IRRIGATION FORM --- */}
                    {type === 'irrigation' && (
                        <>
                            {/* Add Issue Button - REMOVED (Moved to Header) */}
                            {/* Issue Form - REMOVED (Replaced by IssueFormSheet) */}

                            <div className="flex gap-2">
                                {[1, 2, 4, 6].map(hrs => (
                                    <button
                                        key={hrs}
                                        onClick={() => setLocalData({ ...localData, durationHours: hrs })}
                                        className={`flex-1 py-3 rounded-xl border font-bold transition-all ${localData.durationHours === hrs ? 'bg-blue-50 border-blue-300 text-blue-700 ring-1 ring-blue-200' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
                                    >
                                        {hrs}h
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Source</label>
                                    <select
                                        className="w-full p-2.5 border border-slate-200 rounded-xl bg-white mt-1 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                                        value={localData.motorId || ''}
                                        onChange={e => {
                                            const motor = profile.motors.find(m => m.id === e.target.value);
                                            const source = profile.waterResources.find(w => w.id === motor?.linkedWaterSourceId);
                                            setLocalData({ ...localData, motorId: e.target.value, source: source?.name || 'Unknown' });
                                        }}
                                    >
                                        <option value="">Select Motor</option>
                                        {profile.motors.map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Method</label>
                                    <select
                                        className="w-full p-2.5 border border-slate-200 rounded-xl bg-white mt-1 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                                        value={localData.method || 'Drip'}
                                        onChange={e => setLocalData({ ...localData, method: e.target.value })}
                                    >
                                        <option value="Drip">Drip</option>
                                        <option value="Flood">Flood</option>
                                        <option value="Sprinkler">Sprinkler</option>
                                    </select>
                                </div>
                            </div>
                        </>
                    )}

                    {/* --- MACHINERY FORM --- */}
                    {type === 'machinery' && (
                        <>
                            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                                {['tractor', 'sprayer', 'rotavator'].map(m => (
                                    <button
                                        key={m}
                                        onClick={() => setLocalData({ ...localData, type: m })}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg capitalize transition-all ${localData.type === m ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-600'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>

                            {/* Add Issue Button - REMOVED (Moved to Header) */}
                            {/* Issue Form - REMOVED (Replaced by IssueFormSheet) */}

                            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl mb-2">
                                {['owned', 'rented'].map(o => (
                                    <button
                                        key={o}
                                        onClick={() => {
                                            const cost = o === 'rented' ? (defaults.machinery.defaultRentalCost || 1000) : (defaults.machinery.defaultFuelCost || 200);
                                            setLocalData({ ...localData, ownership: o, rentalCost: cost });
                                        }}
                                        className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg capitalize transition-all ${localData.ownership === o ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-600'}`}
                                    >
                                        {o}
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400 uppercase">Usage (Hrs)</label>
                                    <input
                                        type="number"
                                        className={`w-full p-3 border rounded-xl mt-1 font-bold focus:ring-2 outline-none ${localData.ownership === 'owned' && !localData.hoursUsed
                                            ? 'border-amber-300 bg-amber-50 focus:ring-amber-500/20'
                                            : 'border-slate-200 focus:ring-slate-500/20'
                                            }`}
                                        value={localData.hoursUsed || ''}
                                        placeholder="0"
                                        autoFocus
                                        onChange={e => setLocalData({ ...localData, hoursUsed: parseFloat(e.target.value) })}
                                    />
                                    {localData.ownership === 'owned' && !localData.hoursUsed && (
                                        <p className="text-[10px] text-amber-600 font-bold mt-1">Hours mandatory for owned</p>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400 uppercase text-right block">
                                        {localData.ownership === 'rented' ? 'Rental Cost (₹)' : 'Fuel Cost (₹)'}
                                    </label>
                                    <input
                                        type="number"
                                        className="w-full p-3 border border-slate-200 rounded-xl mt-1 focus:ring-2 focus:ring-slate-500/20 outline-none text-right"
                                        value={localData.rentalCost || ''}
                                        placeholder="0"
                                        onChange={e => setLocalData({ ...localData, rentalCost: parseFloat(e.target.value) })}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <Button onClick={() => { onSave(localData); onClose(); }} className="w-full py-4 text-sm shadow-lg">
                    Confirm Details
                </Button>
            </div>

            <IssueFormSheet
                isOpen={showIssueSheet}
                onClose={() => setShowIssueSheet(false)}
                onSave={(newIssue) => {
                    setLocalData({ ...localData, issue: newIssue });
                    setShowIssueSheet(false);
                }}
                initialData={localData.issue}
                bucketType={type}
            />
        </div>,
        document.body // PORTAL TARGET
    );
};

export default DetailSheet;
