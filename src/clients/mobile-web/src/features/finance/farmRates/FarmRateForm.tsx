/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * "नवीन दर" / "दर बदला": what it is for (कशासाठी), its kind, the unit (an input) or the basis (work), for whom (work,
 * optional), the rate, from when, and an optional season and end date. A price is required (a blank one is never stored
 * as ₹ 0). A ShramSafal suggestion or an old draft prefills only what it states — he chooses the kind, unit and basis.
 */
import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { BigButton, ChoiceChips, GlassCard, SectionHead, Tap, TextField } from '../../../shared/components/ui/placeUi';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { carriesItsValues, type SetFarmRateInput } from '../../../application/usecases/sync/SetFarmRateCommand';
import { FARM_RATE_KINDS, WORK_BASES, type FarmRateBasis, type FarmRateKind } from './farmRateSchema';
import type { FarmRateWords } from './farmRateWords';

/** What the form starts from: nothing (a new rate), a rate to change, a suggestion or a draft. */
export interface FarmRateFormStart {
    rateLineId?: string;
    kind?: FarmRateKind;
    itemName?: string;
    unit?: string;
    basis?: FarmRateBasis;
    workerCategory?: string;
    amount?: number;
    effectiveFrom?: string;
    season?: string;
    endsOn?: string;
    suggestionId?: string;
}

interface FarmRateFormProps {
    farmId: string;
    words: FarmRateWords;
    start: FarmRateFormStart;
    changing: boolean;
    newLineId: () => string;
    onSave: (input: SetFarmRateInput) => void;
    onCancel: () => void;
}

export const FarmRateForm: React.FC<FarmRateFormProps> = ({ farmId, words, start, changing, newLineId, onSave, onCancel }) => {
    const [kind, setKind] = useState<FarmRateKind>(start.kind ?? 'Input');
    const [itemName, setItemName] = useState(start.itemName ?? '');
    const [unit, setUnit] = useState(start.unit ?? '');
    const [basis, setBasis] = useState<FarmRateBasis>(start.basis && start.basis !== 'PerUnit' ? start.basis : 'PerDay');
    const [workerCategory, setWorkerCategory] = useState(start.workerCategory ?? '');
    const [amount, setAmount] = useState(start.amount !== undefined ? String(start.amount) : '');
    const [effectiveFrom, setEffectiveFrom] = useState(changing ? getDateKey() : (start.effectiveFrom ?? getDateKey()));
    const [season, setSeason] = useState(start.season ?? '');
    const [endsOn, setEndsOn] = useState(start.endsOn ?? '');

    const parsed = Number(amount);
    const input: SetFarmRateInput = {
        farmId,
        rateLineId: start.rateLineId ?? '',
        change: 'set',
        kind,
        itemName: itemName.trim(),
        ...(kind === 'Input' ? { unit: unit.trim(), basis: 'PerUnit' as const } : { basis }),
        ...(kind === 'Work' && workerCategory.trim() ? { workerCategory: workerCategory.trim() } : {}),
        amount: amount.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined,
        effectiveFrom,
        ...(season.trim() ? { season: season.trim() } : {}),
        ...(endsOn ? { endsOn } : {}),
        ...(start.suggestionId ? { suggestionId: start.suggestionId } : {}),
    };
    const canSave = carriesItsValues(input) && (!endsOn || endsOn >= effectiveFrom);

    const kindChips = FARM_RATE_KINDS.map(k => [k, words.kind[k]] as const);
    const basisChips = WORK_BASES.map(b => [b, words.basis[b]] as const);
    const dateField = (label: string, value: string, set: (v: string) => void, testId: string) => (
        <label className="block">
            <span className="text-[13.5px] font-extrabold text-stone-700">{label}</span>
            <input type="date" value={value} onChange={e => set(e.target.value)} data-testid={testId}
                className="mt-1 min-h-[52px] w-full rounded-xl bg-white px-3 text-[17px] font-bold text-stone-900 outline-none ring-1 ring-stone-300 focus:ring-2 focus:ring-emerald-500" />
        </label>
    );

    return (
        <div id="rate-form" className="space-y-3">
            <SectionHead title={changing ? `${words.change} — ${start.itemName ?? ''}` : words.newRate} hint={changing ? words.changeHint : undefined} />
            <GlassCard testId="rate-form">
                {!changing && <ChoiceChips items={kindChips} value={kind} onPick={setKind} testId="rate-kind" />}
                <div className="mt-3 space-y-2">
                    <TextField label={words.forWhat} value={itemName} onChange={setItemName} placeholder={words.forWhatHint} testId="rate-item" />
                    {kind === 'Input'
                        ? <TextField label={words.unit} value={unit} onChange={setUnit} placeholder={words.unitHint} testId="rate-unit" />
                        : (
                            <>
                                <p className="m-0 text-[13.5px] font-extrabold text-stone-700">{words.basisLabel}</p>
                                <ChoiceChips items={basisChips} value={basis} onPick={setBasis} testId="rate-basis" />
                                <TextField label={words.category} value={workerCategory} onChange={setWorkerCategory} placeholder={words.categoryHint} testId="rate-category" />
                            </>
                        )}
                    <TextField label={words.amount} type="number" value={amount} onChange={setAmount} testId="rate-amount" />
                    {dateField(words.from, effectiveFrom, setEffectiveFrom, 'rate-from')}
                    <TextField label={words.season} value={season} onChange={setSeason} testId="rate-season" />
                    {dateField(words.until, endsOn, setEndsOn, 'rate-until')}
                    <BigButton disabled={!canSave} testId="rate-save"
                        onClick={() => { if (canSave) onSave({ ...input, rateLineId: start.rateLineId ?? newLineId() }); }}>
                        <Plus size={20} aria-hidden="true" />{words.save}
                    </BigButton>
                    <Tap onClick={onCancel} data-testid="rate-cancel"
                        className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-white text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-300">
                        {words.cancel}
                    </Tap>
                </div>
            </GlassCard>
        </div>
    );
};
