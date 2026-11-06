/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72; D-43 "a reference rate is offered
 * as a suggestion to confirm, never a silent wage"; "check local storage for rate drafts before saying nothing can be
 * recovered").
 *
 * Offers to the primary account holder, never applied by themselves: "ShramSafal सुचवलेला दर" (ShramSafal's own suggested
 * rates — an item and an amount only) and the old book's drafts left on this phone. One tap opens the form prefilled with
 * what the offer states; he chooses the kind, unit and basis, and saving makes a normal row of HIS list.
 */
import React from 'react';
import { GlassCard, SectionHead, Tap } from '../../../shared/components/ui/placeUi';
import type { RateDraft } from './farmRateQueue';
import type { RateSuggestion } from './farmRateSchema';
import { rateDate, rateRupees } from './farmRateFormat';
import type { FarmRateWords } from './farmRateWords';

interface RateOffersProps {
    words: FarmRateWords;
    language: string;
    suggestions: RateSuggestion[];
    drafts: RateDraft[];
    onTakeSuggestion: (s: RateSuggestion) => void;
    onTakeDraft: (d: RateDraft) => void;
}

const offerButton = 'flex min-h-[40px] shrink-0 items-center rounded-full bg-white px-3 text-[13.5px] font-extrabold text-emerald-800 ring-1 ring-emerald-300';

export const RateOffers: React.FC<RateOffersProps> = ({ words, language, suggestions, drafts, onTakeSuggestion, onTakeDraft }) => (
    <>
        {drafts.length > 0 && (
            <div className="space-y-2" data-testid="rate-drafts">
                <SectionHead title={words.draftTitle} />
                {drafts.map(d => (
                    <GlassCard key={d.key} testId={`rate-draft-${d.key}`}>
                        <div className="flex items-center justify-between gap-2">
                            <p className="m-0 min-w-0 text-[15px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">
                                {d.itemName} — {rateRupees(d.amount)}{d.unit ? ` / ${d.unit}` : ''}
                            </p>
                            <Tap onClick={() => onTakeDraft(d)} data-testid={`rate-draft-take-${d.key}`} className={offerButton}>{words.draftTake}</Tap>
                        </div>
                    </GlassCard>
                ))}
            </div>
        )}
        {suggestions.length > 0 && (
            <div className="space-y-2" data-testid="rate-suggestions">
                <SectionHead title={words.suggested} hint={words.suggestedHint} />
                {suggestions.map(s => (
                    <GlassCard key={s.id} testId={`rate-suggestion-${s.id}`}>
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="m-0 text-[15px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{s.itemName} — {rateRupees(s.unitPrice)}</p>
                                {rateDate(s.effectiveFrom, language) && (
                                    <p className="m-0 text-[12.5px] font-bold text-stone-500">{words.since(rateDate(s.effectiveFrom, language))}</p>
                                )}
                            </div>
                            <Tap onClick={() => onTakeSuggestion(s)} data-testid={`rate-suggestion-take-${s.id}`} className={offerButton}>{words.takeSuggestion}</Tap>
                        </div>
                    </GlassCard>
                ))}
            </div>
        )}
    </>
);
