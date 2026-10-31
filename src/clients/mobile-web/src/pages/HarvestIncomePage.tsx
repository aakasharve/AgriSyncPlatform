/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — उत्पन्न, route 'income', in the founder-approved look
 * (PLR-D9 preview `PlacePages.IncomePage`) over the REAL records. It was English ("Income", "Other Income",
 * "+ Add Custom"). Every real part is kept:
 *   - "कापणी आणि विक्री": the honest `HarvestComingSoon` notice (below — why there is no sale here);
 *   - "इतर उत्पन्न": under "+ जोडा", each kind (भंगार / अनुदान / भाडं / इतर) opens the same `OtherIncomeSheet`
 *     with its word already in "काय?"; it saves through `addOtherIncomeEntry`; the list reads
 *     `getOtherIncomeEntries` (each entry: what, amount, day, its source, its crop);
 *   - the row to पैसे व हिशोब.
 * The money card shows only what is recorded (P4): no sale is recorded anywhere this page can read, so it says
 * so in words and shows no sale figure; other income shows its sum over every entry so far, or "अजून नोंद
 * नाही" — never ₹ 0. It does not say "this season": these entries carry no season.
 * There is no "tell a sale" button: the log flow does not record a sale or any income, so it would promise a
 * record nobody keeps. A button whose handler the route did not give is not drawn (P5).
 *
 * Route: 'income'. Reached from BottomNavigation's "Income" tab and from the overview's in-hand card.
 *
 * Task 6 (spec D4): the harvest sale/session/config tracking that used to
 * live on this page had no backend at all, and its save handler wrote to
 * React state only — a recorded sale vanished the moment the farmer
 * navigated away. That whole flow (config, "Log New Harvest", patti upload,
 * grade-wise sale entry, pending-sale/payment banner, session history) is
 * replaced below with `HarvestComingSoon`, an honest "not built yet"
 * message. See that component's doc comment for the full trace.
 */

import React, { useState } from 'react';
import { BookOpen, IndianRupee, KeyRound, Landmark, Plus, Recycle } from 'lucide-react';
import {
    FarmContext,
    CropProfile
} from '../types';
import { OtherIncomeEntry } from '../features/logs/harvest.types';
import { getOtherIncomeEntries } from '../services/harvestService';
import HarvestComingSoon from '../features/logs/components/harvest/HarvestComingSoon';
import { useLanguage } from '../i18n/LanguageContext';
import OtherIncomeSheet from '../features/logs/components/harvest/OtherIncomeSheet';
import { OTHER_INCOME_KINDS, OTHER_INCOME_SOURCE_LABEL, type OtherIncomeKind } from '../features/logs/components/harvest/otherIncomeLabels';
import { fromDateKey, relLabel, rupees } from '../features/reflect/overview/reflectDates';
import { Chip, GlassCard, PageBar, RowLink, SANS, SectionHead, Tap } from '../shared/components/ui/placeUi';
import { cropNameIn } from '../shared/names/namesIn';

/** Font rule: figures in DM Sans. */
const NUM = "'DM Sans', sans-serif";

const KIND_ICON: Record<OtherIncomeKind, React.ReactNode> = {
    scrap: <Recycle size={20} aria-hidden="true" />,
    subsidy: <Landmark size={20} aria-hidden="true" />,
    rent: <KeyRound size={20} aria-hidden="true" />,
    other: <IndianRupee size={20} aria-hidden="true" />,
};

const dayOf = (key: string): string => (/^\d{4}-\d{2}-\d{2}/.test(key) ? relLabel(fromDateKey(key)) : '');

interface HarvestIncomePageProps {
    /** Still handed in by the route; unused here. */
    context?: FarmContext | null;
    crops: CropProfile[];
    onBack?: () => void;
    onGo?: (route: 'finance-manager') => void;
}

const HarvestIncomePage: React.FC<HarvestIncomePageProps> = ({ crops, onBack, onGo }) => {
    // The harvest notice is the one thing on this page a farmer must be
    // able to READ — it is what tells him a sale recorded here is not
    // saved — so it is handed the same language preference every other
    // surface reads (the app defaults to Marathi, `i18n/LanguageContext.tsx`).
    const { language } = useLanguage();
    /** The kind word the sheet opens with, or null when the sheet is shut. */
    const [sheetWord, setSheetWord] = useState<string | null>(null);
    const [otherIncome, setOtherIncome] = useState<OtherIncomeEntry[]>(() => getOtherIncomeEntries());

    const otherTotal = otherIncome.reduce((s, o) => s + o.amount, 0);
    // spec I18 — the line is Marathi: the crop in Marathi (never the server's "Grapes").
    const cropName = (id?: string) => {
        const crop = id ? crops.find(c => c.id === id) : undefined;
        return crop ? cropNameIn(crop.name, 'mr', crop.masterId) : undefined;
    };

    return (
        <div className="pb-24 animate-in fade-in max-w-4xl mx-auto px-4 sm:px-6" style={{ fontFamily: SANS }} data-testid="income-page">
            <PageBar title="उत्पन्न" onBack={onBack} />
            <div className="space-y-3">
                <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">शेतातून आलेले पैसे — विक्री आणि इतर उत्पन्न.</p>

                <GlassCard testId="income-total">
                    <p className="m-0 text-[14px] font-extrabold text-stone-700">हातात आलेले पैसे</p>
                    <div className="mt-2 flex items-center justify-between gap-2" data-testid="income-sales">
                        <Chip tone="green">विक्री</Chip>
                        <span className="text-right text-[14px] font-bold text-stone-600">अजून इथे नोंद होत नाही</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2" data-testid="income-other-total">
                        <Chip tone="blue">इतर उत्पन्न</Chip>
                        {otherIncome.length > 0
                            ? <span className="text-[24px] font-extrabold leading-tight text-emerald-800" style={{ fontFamily: NUM }}>{rupees(otherTotal)}</span>
                            : <span className="text-[14px] font-bold text-stone-600">अजून नोंद नाही</span>}
                    </div>
                    {otherIncome.length > 0 && (
                        <p className="m-0 mt-1.5 text-[12.5px] font-semibold text-stone-500">आतापर्यंत नोंदवलेल्या सगळ्या इतर उत्पन्नाची बेरीज</p>
                    )}
                </GlassCard>

                <SectionHead title="कापणी आणि विक्री" hint="किती, कोणाला, कोणत्या भावाने" />
                {/* HARVEST — not built (spec D4, Task 6): the notice, and no control that could start a sale. */}
                <HarvestComingSoon language={language} />

                <SectionHead title="इतर उत्पन्न" hint="भंगार, अनुदान, भाडं — शेतातून आलेले इतर पैसे" />
                <GlassCard testId="income-add">
                    <p className="m-0 mb-2 flex items-center gap-1.5 text-[15px] font-extrabold text-stone-800"><Plus size={18} aria-hidden="true" />जोडा</p>
                    <div className="grid grid-cols-4 gap-2">
                        {OTHER_INCOME_KINDS.map(([k, word]) => (
                            <Tap key={k} onClick={() => setSheetWord(word)} data-testid={`income-kind-${k}`}
                                className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300">
                                {KIND_ICON[k]}{word}
                            </Tap>
                        ))}
                    </div>
                </GlassCard>

                {otherIncome.length === 0 ? (
                    <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[14px] font-bold text-stone-500" data-testid="income-other-empty">
                        अजून काही इतर उत्पन्न नोंदवलेलं नाही.
                    </p>
                ) : (
                    <div className="space-y-2" data-testid="income-other-list">
                        {otherIncome.map(inc => (
                            <GlassCard key={inc.id} testId={`other-income-${inc.id}`}>
                                <div className="flex items-baseline justify-between gap-2">
                                    <p className="m-0 min-w-0 text-[16px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{inc.description}</p>
                                    <p className="m-0 shrink-0 text-[17px] font-extrabold text-emerald-800" style={{ fontFamily: NUM }}>{rupees(inc.amount)}</p>
                                </div>
                                <p className="m-0 text-[12.5px] font-bold text-stone-500">
                                    {[dayOf(inc.date), OTHER_INCOME_SOURCE_LABEL[inc.source] ?? OTHER_INCOME_SOURCE_LABEL.OTHER, cropName(inc.cropId)].filter(Boolean).join(' · ')}
                                </p>
                            </GlassCard>
                        ))}
                    </div>
                )}

                {onGo && (
                    <RowLink icon={<BookOpen size={22} aria-hidden="true" />} tone="blue" title="पैसे व हिशोब" line="नफा-तोटा, वही आणि अहवाल"
                        onClick={() => onGo('finance-manager')} testId="income-finance" />
                )}
            </div>

            {sheetWord !== null && (
                <OtherIncomeSheet
                    crops={crops}
                    initialDescription={sheetWord}
                    onClose={() => setSheetWord(null)}
                    onSave={() => {
                        setOtherIncome(getOtherIncomeEntries());
                        setSheetWord(null);
                    }}
                />
            )}
        </div>
    );
};

export default HarvestIncomePage;
