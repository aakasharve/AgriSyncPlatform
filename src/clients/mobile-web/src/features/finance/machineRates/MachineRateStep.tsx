/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov: "the rate card question must be asked right after user
 * adds a machine to his farm"). The small OPTIONAL step after a machine is saved (and the "दर लिहा / दर बदला" form on a machine card):
 * the rate he types and what it is per. Nothing is chosen for him: the amount starts blank and no basis is picked, and "जतन करा" waits for
 * both. "नंतर" always closes it with nothing saved (P9: never a block). What it saves is a line of the farm's दरपत्रक (`machineRateModel`).
 */
import React, { useState } from 'react';
import { BigButton, ChoiceChips, GlassCard, Tap, TextField } from '../../../shared/components/ui/placeUi';
import { twoDecimalsInput } from '../../profile/farmSetup/numbers';
import { farmRateWords } from '../farmRates/farmRateWords';
import type { FarmRateBasis } from '../farmRates/farmRateSchema';
import { MACHINE_RATE_BASES } from './machineRateModel';
import { machineRateWords } from './machineRateWords';

interface MachineRateStepProps {
    machineName: string;
    language?: string | null;
    /** A rate to change (its current amount and basis); absent for a machine with no rate yet. */
    start?: { amount: number; basis: FarmRateBasis };
    /** Queues the rate; resolves false when it could not be queued (the step stays open with what he typed). */
    onSave: (amount: number, basis: FarmRateBasis) => Promise<boolean>;
    onLater: () => void;
}

/** The server keeps at most ₹ 1,00,00,000 (`FarmRate.MaxAmount`): anything above is never queued. */
const MAX_AMOUNT = 10_000_000;

export const MachineRateStep: React.FC<MachineRateStepProps> = ({ machineName, language, start, onSave, onLater }) => {
    const rate = farmRateWords(language);
    const words = machineRateWords(language);
    const [amount, setAmount] = useState(start ? String(start.amount) : '');
    const [basis, setBasis] = useState<FarmRateBasis | ''>(start?.basis && start.basis !== 'PerUnit' ? start.basis : '');
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);

    const typed = Number(amount);
    const ok = amount.trim() !== '' && Number.isFinite(typed) && typed > 0 && typed <= MAX_AMOUNT && basis !== '';
    const chips = MACHINE_RATE_BASES.map(b => [b, rate.basis[b]] as const);

    const save = async () => {
        if (!ok || busy) return; // `ok` holds only with a basis picked (TypeScript narrows `basis` from it)
        setBusy(true);
        setFailed(false);
        const saved = await onSave(typed, basis);
        setBusy(false);
        if (!saved) setFailed(true);
    };

    return (
        <GlassCard className="ring-2 ring-violet-300" testId="machine-rate-step">
            <p className="m-0 text-[17px] font-extrabold text-stone-900">{words.stepTitle}</p>
            <p className="m-0 text-[15px] font-bold text-stone-700 [overflow-wrap:anywhere]" data-testid="machine-rate-step-name">{machineName}</p>
            <p className="m-0 mt-1 text-[13.5px] font-semibold leading-snug text-stone-600">{words.stepHint}</p>
            <div className="mt-3 space-y-3">
                <TextField label={rate.amount} type="number" value={amount} testId="machine-rate-amount"
                    onChange={v => { setAmount(twoDecimalsInput(v)); setFailed(false); }} />
                <p className="m-0 text-[13.5px] font-extrabold text-stone-700">{rate.basisLabel}</p>
                <ChoiceChips<FarmRateBasis | ''> items={chips} value={basis} onPick={setBasis} testId="machine-rate-basis" />
                <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600" data-testid="machine-rate-note">{words.stepNote}</p>
                <BigButton onClick={() => { void save(); }} disabled={!ok || busy} testId="machine-rate-save">{rate.save}</BigButton>
                <Tap onClick={onLater} data-testid="machine-rate-later"
                    className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-white text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-300">
                    {words.later}
                </Tap>
                {failed && <p className="m-0 text-center text-[14px] font-extrabold text-rose-800" role="alert" data-testid="machine-rate-failed">{rate.refusedOther}</p>}
            </div>
        </GlassCard>
    );
};
