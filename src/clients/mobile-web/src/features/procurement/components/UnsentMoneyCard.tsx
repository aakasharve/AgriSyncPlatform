/**
 * spec: pre-launch-repair L2b (R-4; founder D-41 phase A) — "फोनवर राहिलेल्या नोंदी — पाठवायच्या" in खरेदी:
 * money and bill photos that are on this phone and never reached the server (`unsentMoney.ts`). Each row says
 * what it is, how much, and where it goes; it is sent ONLY when the farmer confirms the farm ("<शेत> — हो,
 * पाठवा"). A row whose plot the server does not have says it stays on the phone and offers nothing. A farm the
 * phone cannot prove (an old bill saved before bills knew their farm) is chosen by the farmer — never guessed.
 * Shows nothing until the phone has finished a download (it cannot tell what the server holds before that),
 * and nothing when nothing is left.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import type { CropProfile } from '../../../types';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import { BigButton, ChoiceChips, GlassCard, SectionHead } from '../../../shared/components/ui/placeUi';
import { listUnsentMoney, sendUnsentGroup, type UnsentGroup, type UnsentMoney } from '../unsentMoney';

// PROPOSED (Marathi)
export const UNSENT_TITLE_MR = 'फोनवर राहिलेल्या नोंदी — पाठवायच्या';
// PROPOSED (Marathi)
export const UNSENT_HINT_MR = 'या नोंदी अजून सर्व्हरवर पोहोचल्या नाहीत. शेत बरोबर आहे ना ते पाहा, मग पाठवा.';
// PROPOSED (Marathi) — its plot is not on the server: kept, not offered.
export const STAYS_ON_PHONE_MR = 'हा प्लॉट अजून सर्व्हरवर नाही — ही नोंद फोनवरच राहील.';
// PROPOSED (Marathi)
export const PICK_FARM_MR = 'ही नोंद कोणत्या शेताची?';
// PROPOSED (Marathi)
export const NO_FARM_MR = 'या फोनवर अजून एकही शेत नाही — ही नोंद फोनवरच आहे.';
// PROPOSED (Marathi) — only the bill's photo is left to send.
export const PHOTO_ONLY_MR = 'बिलाचा फोटो पाठवायचा राहिला';
// PROPOSED (Marathi)
export const WHOLE_FARM_MR = 'संपूर्ण शेत';
// PROPOSED (Marathi)
export const sendLabelMr = (farmName: string) => `${farmName} — हो, पाठवा`;
// PROPOSED (Marathi) — something could not be put in the outbox even now.
export const STILL_KEPT_MR = 'काही नोंदी अजून पाठवता आल्या नाहीत — त्या फोनवरच आहेत.';

interface Props {
    crops: CropProfile[];
    /** The bills changed (a bill learned its farm or its photo): the page reloads them. */
    onSent?: () => void;
}

export const UnsentMoneyCard: React.FC<Props> = ({ crops, onSent }) => {
    const farms = useOptionalFarmContext()?.farms ?? [];
    const [unsent, setUnsent] = useState<UnsentMoney | null>(null);
    const [picked, setPicked] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [stillKept, setStillKept] = useState(false);

    const refresh = useCallback(() => {
        listUnsentMoney().then(setUnsent).catch(() => setUnsent(null));
    }, []);
    useEffect(() => {
        refresh();
        window.addEventListener('agrisync:finance-cache-updated', refresh);
        return () => window.removeEventListener('agrisync:finance-cache-updated', refresh);
    }, [refresh]);

    if (!unsent?.ready || unsent.groups.length === 0) return null;

    const plotName = (plotId?: string) => (plotId
        ? crops.flatMap(c => c.plots).find(p => p.id === plotId)?.name ?? 'प्लॉट'
        : WHOLE_FARM_MR);
    const farmName = (farmId: string) => farms.find(f => f.farmId === farmId)?.name ?? 'हे शेत';
    const farmFor = (g: UnsentGroup): string | null =>
        g.proposedFarmId ?? picked[g.key] ?? (farms.length === 1 ? farms[0].farmId : null);

    const send = async (g: UnsentGroup, farmId: string) => {
        setBusy(g.key);
        try {
            const result = await sendUnsentGroup(g, farmId);
            setStillKept(result.kept > 0);
            onSent?.();
        } finally {
            setBusy(null);
            refresh();
        }
    };

    return (
        <GlassCard testId="unsent-money" className="border-amber-300 bg-amber-50/80">
            <div className="mb-2 flex items-start gap-2">
                <CloudUpload size={22} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
                <SectionHead title={UNSENT_TITLE_MR} hint={UNSENT_HINT_MR} />
            </div>
            {stillKept && <p className="m-0 mb-2 text-[13px] font-bold text-amber-800" data-testid="unsent-still-kept">{STILL_KEPT_MR}</p>}
            <ul className="m-0 list-none space-y-2 p-0">
                {unsent.groups.map(g => {
                    const farm = farmFor(g);
                    return (
                        <li key={g.key} className="rounded-2xl bg-white p-3 ring-1 ring-amber-200" data-testid={`unsent-${g.key}`}>
                            <p className="m-0 text-[15px] font-extrabold text-stone-900">
                                {g.total > 0 ? `₹${g.total.toLocaleString('en-IN')}` : PHOTO_ONLY_MR}
                                <span className="ml-2 text-[13px] font-bold text-stone-500">{g.date}</span>
                            </p>
                            <p className="m-0 text-[13.5px] font-semibold text-stone-700">
                                {[g.label, plotName(g.plotId)].filter(Boolean).join(' · ')}
                                {g.total > 0 && g.photoDataUrl ? ` · ${PHOTO_ONLY_MR}` : ''}
                            </p>
                            {!g.sendable ? (
                                <p className="m-0 mt-2 text-[13px] font-bold text-amber-800" data-testid={`unsent-stays-${g.key}`}>{STAYS_ON_PHONE_MR}</p>
                            ) : farms.length === 0 ? (
                                <p className="m-0 mt-2 text-[13px] font-bold text-amber-800">{NO_FARM_MR}</p>
                            ) : (
                                <div className="mt-2 space-y-2">
                                    {g.proposedFarmId === null && farms.length > 1 && (
                                        <>
                                            <p className="m-0 text-[13px] font-bold text-stone-700">{PICK_FARM_MR}</p>
                                            <ChoiceChips items={farms.map(f => [f.farmId, f.name] as const)} value={picked[g.key] ?? ''}
                                                onPick={id => setPicked(p => ({ ...p, [g.key]: id }))} testId={`unsent-farm-${g.key}`} />
                                        </>
                                    )}
                                    <BigButton onClick={() => { if (farm) void send(g, farm); }} disabled={!farm || busy !== null} testId={`unsent-send-${g.key}`}>
                                        {farm ? sendLabelMr(farmName(farm)) : PICK_FARM_MR}
                                    </BigButton>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </GlassCard>
    );
};
