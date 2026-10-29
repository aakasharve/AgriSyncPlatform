/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "इतर उत्पन्न जोडा", in Marathi and in the redesign's
 * look (`placeUi`). It was English ("Add Other Income", "RESIDUE", "Save Income"). The same fields — amount,
 * source, what, crop (optional), date — the same "amount and what are both needed", and the same save:
 * `addOtherIncomeEntry`, which stores the entry and sends its money entry. One addition: `initialDescription`,
 * so a kind tile on उत्पन्न (भंगार, अनुदान…) opens the sheet with that word already in "काय?", in plain view.
 */

import React, { useState } from 'react';
import {
    OtherIncomeEntry,
    CropProfile
} from '../../../../types';
import { X, Save } from 'lucide-react';
import { addOtherIncomeEntry } from '../../../../services/harvestService';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { idGenerator } from '../../../../core/domain/services/IdGenerator';
import { BigButton, ChoiceChips, SANS, TextField } from '../../../../shared/components/ui/placeUi';
import { OTHER_INCOME_SOURCE_LABEL } from './otherIncomeLabels';

interface OtherIncomeSheetProps {
    crops: CropProfile[]; // For linking to crop
    onClose: () => void;
    onSave: () => void;
    /** Pre-written "काय?" (the kind tile the farmer tapped); he can change it. */
    initialDescription?: string;
}

const SOURCES = (Object.keys(OTHER_INCOME_SOURCE_LABEL) as OtherIncomeEntry['source'][])
    .map(s => [s, OTHER_INCOME_SOURCE_LABEL[s]] as const);

const OtherIncomeSheet: React.FC<OtherIncomeSheetProps> = ({ crops, onClose, onSave, initialDescription = '' }) => {
    const [amount, setAmount] = useState<string>('');
    const [source, setSource] = useState<OtherIncomeEntry['source']>('OTHER');
    const [description, setDescription] = useState(initialDescription);
    const [date, setDate] = useState(getDateKey());
    const [selectedCropId, setSelectedCropId] = useState<string>('');
    // spec: pre-launch-repair L2b (R-1) — this entry's identity, minted ONCE when the sheet opens: a second tap
    // on save stores the same entry and sends the same money entry, never a second income.
    const [entryId] = useState(() => `inc_${idGenerator.generate()}`);

    const handleSubmit = () => {
        if (!amount || !description) return;

        addOtherIncomeEntry({
            id: entryId,
            amount: parseFloat(amount),
            source,
            description,
            date,
            cropId: selectedCropId || undefined
            // plotId can be added if we select plot context
        });

        onSave();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
            style={{ fontFamily: SANS }} data-testid="other-income-sheet">
            <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-3xl shadow-xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-stone-100">
                    <h2 className="m-0 text-[19px] font-extrabold text-stone-900">इतर उत्पन्न जोडा</h2>
                    <button type="button" onClick={onClose} aria-label="बंद करा" className="grid h-11 w-11 place-items-center rounded-full text-stone-600 hover:bg-stone-100">
                        <X size={22} />
                    </button>
                </div>

                {/* Form */}
                <div className="p-4 space-y-4 overflow-y-auto">

                    {/* Amount */}
                    <TextField label="मिळालेली रक्कम (₹)" type="number" value={amount} onChange={setAmount} placeholder="रक्कम" testId="other-income-amount" />

                    {/* Source Type */}
                    <div>
                        <span className="mb-1 block text-[13.5px] font-extrabold text-stone-700">कशातून आले?</span>
                        <ChoiceChips items={SOURCES} value={source} onPick={setSource} testId="other-income-source" />
                    </div>

                    {/* Description */}
                    <TextField label="काय?" value={description} onChange={setDescription} placeholder="उदा. जुनी ठिबक नळी भंगारात विकली" testId="other-income-what" />

                    {/* Crop Context (Optional) */}
                    <label className="block">
                        <span className="text-[13.5px] font-extrabold text-stone-700">कोणत्या पिकाचं? (हवं तर)</span>
                        <select
                            value={selectedCropId}
                            onChange={(e) => setSelectedCropId(e.target.value)}
                            data-testid="other-income-crop"
                            className="mt-1 min-h-[52px] w-full rounded-xl bg-white px-3 text-[16px] font-bold text-stone-900 ring-1 ring-stone-300"
                        >
                            <option value="">सर्व शेताचं उत्पन्न</option>
                            {crops.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </label>

                    {/* Date */}
                    <label className="block">
                        <span className="text-[13.5px] font-extrabold text-stone-700">तारीख</span>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            data-testid="other-income-date"
                            className="mt-1 min-h-[52px] w-full rounded-xl bg-white px-3 text-[16px] font-bold text-stone-900 ring-1 ring-stone-300"
                        />
                    </label>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-stone-100 bg-stone-50 rounded-b-3xl sm:rounded-b-2xl">
                    <BigButton onClick={handleSubmit} disabled={!amount || !description} testId="other-income-save">
                        <Save size={20} aria-hidden="true" />जतन करा
                    </BigButton>
                </div>

            </div>
        </div>
    );
};

export default OtherIncomeSheet;
