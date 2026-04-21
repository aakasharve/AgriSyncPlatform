import React, { useState } from 'react';
import DeviationReasonPicker, { DeviationReason } from './DeviationReasonPicker';

export type ExecutionStatus = 'Completed' | 'Partial' | 'Skipped' | 'Delayed' | 'Modified';

interface StatusChipConfig {
    status: ExecutionStatus;
    icon: string;
    labelEn: string;
    labelMr: string;
}

const STATUS_CHIPS: StatusChipConfig[] = [
    { status: 'Completed', icon: '✓', labelEn: 'Done', labelMr: 'झालं' },
    { status: 'Partial',   icon: '◐', labelEn: 'Partial', labelMr: 'अर्धं' },
    { status: 'Skipped',   icon: '✕', labelEn: 'Skipped', labelMr: 'नाही केलं' },
    { status: 'Delayed',   icon: '⏱', labelEn: 'Delayed', labelMr: 'उशीर' },
    { status: 'Modified',  icon: '↻', labelEn: 'Changed', labelMr: 'बदलून केलं' },
];

const chipActive: Record<ExecutionStatus, string> = {
    Completed: 'border-emerald-400 bg-emerald-50 text-emerald-700',
    Partial:   'border-amber-400 bg-amber-50 text-amber-700',
    Skipped:   'border-stone-400 bg-stone-100 text-stone-700',
    Delayed:   'border-orange-400 bg-orange-50 text-orange-700',
    Modified:  'border-blue-400 bg-blue-50 text-blue-700',
};

const DEFAULT_DEVIATION_REASONS: DeviationReason[] = [
    { code: 'weather', labelEn: 'Weather issue', labelMr: 'हवामान समस्या' },
    { code: 'labor', labelEn: 'Labour not available', labelMr: 'मजूर नव्हते' },
    { code: 'input', labelEn: 'Input not available', labelMr: 'साहित्य नव्हतं' },
    { code: 'equipment', labelEn: 'Equipment problem', labelMr: 'यंत्र बिघडलं' },
    { code: 'decision', labelEn: 'My decision', labelMr: 'माझा निर्णय' },
];

interface ExecutionStatusSelectorProps {
    value: ExecutionStatus;
    onChange: (status: ExecutionStatus, deviationCode?: string, deviationNote?: string) => void;
    deviationReasons?: DeviationReason[];
}

const ExecutionStatusSelector: React.FC<ExecutionStatusSelectorProps> = ({
    value,
    onChange,
    deviationReasons = DEFAULT_DEVIATION_REASONS,
}) => {
    const [selectedDeviation, setSelectedDeviation] = useState<string | null>(null);

    const showDeviation = value !== 'Completed';

    const handleChipClick = (status: ExecutionStatus) => {
        setSelectedDeviation(null);
        onChange(status);
    };

    const handleDeviationSelect = (code: string, note?: string) => {
        setSelectedDeviation(code);
        onChange(value, code, note);
    };

    return (
        <div>
            {/* Disclosure label */}
            <p
                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                className="text-xs font-medium text-stone-500 mb-2"
            >
                हे व्यवस्थित झालं का?{' '}
                <span style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-stone-400">
                    Didn't happen as planned?
                </span>
            </p>

            {/* Chip row */}
            <div className="flex flex-wrap gap-2">
                {STATUS_CHIPS.map(chip => {
                    const isActive = value === chip.status;
                    return (
                        <button
                            key={chip.status}
                            type="button"
                            onClick={() => handleChipClick(chip.status)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                                isActive
                                    ? chipActive[chip.status]
                                    : 'border-stone-200 bg-white text-stone-500 active:bg-stone-50'
                            }`}
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            <span className="text-base leading-none">{chip.icon}</span>
                            <span>{chip.labelEn}</span>
                            <span
                                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                className="text-xs opacity-70"
                            >
                                {chip.labelMr}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Deviation reason picker — shown for non-Completed statuses */}
            {showDeviation && (
                <DeviationReasonPicker
                    reasons={deviationReasons}
                    selected={selectedDeviation}
                    onSelect={handleDeviationSelect}
                />
            )}
        </div>
    );
};

export default ExecutionStatusSelector;
