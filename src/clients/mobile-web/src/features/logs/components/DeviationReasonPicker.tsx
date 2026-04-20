import React, { useState } from 'react';

export interface DeviationReason {
    code: string;
    labelEn: string;
    labelMr: string;
}

interface DeviationReasonPickerProps {
    reasons: DeviationReason[];
    selected: string | null;
    onSelect: (code: string, note?: string) => void;
}

const DeviationReasonPicker: React.FC<DeviationReasonPickerProps> = ({
    reasons,
    selected,
    onSelect,
}) => {
    const [otherNote, setOtherNote] = useState('');

    const otherReason: DeviationReason = { code: 'other', labelEn: 'Other', labelMr: 'इतर' };
    const allReasons = [...reasons, otherReason];

    const handleSelect = (code: string) => {
        if (code !== 'other') {
            onSelect(code);
        } else {
            onSelect(code, otherNote);
        }
    };

    return (
        <div className="mt-2 rounded-xl border border-stone-100 bg-stone-50 p-3 flex flex-col gap-2">
            <p
                style={{ fontFamily: "'DM Sans', sans-serif" }}
                className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1"
            >
                Reason
            </p>
            {allReasons.map(reason => (
                <label
                    key={reason.code}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                        selected === reason.code
                            ? 'border-emerald-300 bg-emerald-50'
                            : 'border-stone-200 bg-white'
                    }`}
                >
                    <input
                        type="radio"
                        name="deviation-reason"
                        value={reason.code}
                        checked={selected === reason.code}
                        onChange={() => handleSelect(reason.code)}
                        className="accent-emerald-600 flex-shrink-0"
                    />
                    <div>
                        <p
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-sm font-medium text-stone-800 leading-snug"
                        >
                            {reason.labelMr}
                        </p>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-400"
                        >
                            {reason.labelEn}
                        </p>
                    </div>
                </label>
            ))}

            {selected === 'other' && (
                <textarea
                    rows={2}
                    value={otherNote}
                    onChange={e => {
                        setOtherNote(e.target.value);
                        onSelect('other', e.target.value);
                    }}
                    placeholder="Describe the reason..."
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-emerald-300 resize-none mt-1"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                />
            )}
        </div>
    );
};

export default DeviationReasonPicker;
