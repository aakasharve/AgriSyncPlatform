/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6). "माझी शेती व जबाबदाऱ्या" (PROPOSED): on the
 * Setup Hub, one card per relationship - active, invited (स्वीकारा / नको, MU-2's card), waiting for the owner, or paused with
 * its reason. Each shows the farm and the label, the plots, the plain-word authorities and the expiry (only when near).
 * It reads `/me/context` ONLY (one read model, no parallel client arrays). A waiting invitation or request is a card HERE
 * and never a row in the switcher (visible is not operational).
 *
 * A single-farm primary owner with nothing waiting sees nothing new (Scenario A): the section is not drawn.
 */
import React, { useMemo } from 'react';
import { CheckCircle2, Clock3, PauseCircle } from 'lucide-react';
import { GlassCard, SectionHead } from '../../shared/components/ui/placeUi';
import { invalidateMeContext, type MeAuthority } from '../../core/session/MeContextService';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { InvitationCard } from '../invitations/InvitationCard';
import { invitationCopy } from '../invitations/invitationCopy';
import { cardLines, dayOf } from '../invitations/invitationModel';
import type { InvitationCard as InvitationCardData, InvitationLabel } from '../invitations/personalInvitationClient';
import { relationshipCopy } from './relationshipCopy';
import { labelKeyOf, relationshipCards, type RelationshipCardModel } from './relationshipModel';

/** Does the section have anything beyond "I own my one farm"? (Scenario A: nothing new for him.) */
export function hasRelationshipsToShow(
    cards: readonly RelationshipCardModel[],
    invitations: readonly unknown[],
): boolean {
    if (invitations.length > 0) return true;
    if (cards.some(c => c.state !== 'active' || !c.isPrimary)) return true;
    return cards.filter(c => c.state === 'active').length > 1;
}

export const MyResponsibilities: React.FC = () => {
    const farmContext = useOptionalFarmContext();
    const language = useOptionalLanguage()?.language;
    const copy = relationshipCopy(language);
    const meContext = farmContext?.meContext ?? null;
    const currentFarmId = farmContext?.currentFarmId ?? null;
    const cards = useMemo(() => relationshipCards(meContext, language), [meContext, language]);
    const invitations = useMemo(() => (Array.isArray(meContext?.invitations) ? meContext.invitations : []), [meContext]);
    const farmsById = useMemo(() => new Map((meContext?.farms ?? []).map(f => [f.farmId, f])), [meContext]);

    if (!meContext || !hasRelationshipsToShow(cards, invitations)) return null;

    return (
        <section className="space-y-2" data-testid="my-responsibilities">
            <SectionHead title={copy.cards.title} hint={copy.cards.intro} />

            {invitations.map(item => (
                <InvitationCard
                    key={item.invitationId}
                    card={{ ...item, label: item.label as InvitationLabel, status: 'Waiting', namesYou: true } as InvitationCardData}
                    onAnswered={() => { invalidateMeContext(); void farmContext?.refresh(); }}
                />
            ))}

            {cards.map(card => {
                const seat = farmsById.get(card.farmId);
                const isCurrent = card.state === 'active' && card.farmId === currentFarmId;
                return (
                    <GlassCard key={card.farmId} testId={`relationship-card-${card.farmId}`}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="m-0 text-[17px] font-extrabold text-stone-900 [overflow-wrap:anywhere]" data-testid="relationship-farm">{card.farmName}</p>
                                <p className="m-0 text-[14px] font-extrabold text-emerald-800" data-testid="relationship-word">{card.word}</p>
                            </div>
                            {isCurrent && (
                                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-extrabold text-emerald-900" data-testid="relationship-opened">
                                    {copy.cards.opened}
                                </span>
                            )}
                        </div>

                        {card.state === 'waiting' && (
                            <div className="mt-2 flex items-start gap-2" data-testid="relationship-waiting">
                                <Clock3 size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
                                <div>
                                    <p className="m-0 text-[15px] font-extrabold text-stone-900">{copy.cards.waitingTitle}</p>
                                    <p className="m-0 text-[13.5px] font-semibold text-stone-600">{copy.cards.waitingLine}</p>
                                </div>
                            </div>
                        )}

                        {card.state === 'paused' && (
                            <div className="mt-2 flex items-start gap-2" data-testid="relationship-paused">
                                <PauseCircle size={18} className="mt-0.5 shrink-0 text-rose-700" aria-hidden="true" />
                                <div>
                                    <p className="m-0 text-[15px] font-extrabold text-stone-900">{copy.cards.pausedTitle}</p>
                                    <p className="m-0 text-[13.5px] font-semibold text-stone-600">{copy.cards.pausedLine(card.reason)}</p>
                                </div>
                            </div>
                        )}

                        {card.state === 'active' && seat && (
                            <div className="mt-2 space-y-1" data-testid="relationship-active">
                                <p className="m-0 flex items-center gap-1.5 text-[14px] font-extrabold text-stone-800">
                                    <CheckCircle2 size={16} className="text-emerald-700" aria-hidden="true" />{copy.cards.activeTitle}
                                </p>
                                <ActiveLines card={card} labelKey={labelKeyOf(seat)} language={language} />
                            </div>
                        )}
                    </GlassCard>
                );
            })}
        </section>
    );
};

const ActiveLines: React.FC<{
    card: RelationshipCardModel;
    labelKey: ReturnType<typeof labelKeyOf>;
    language: string | null | undefined;
}> = ({ card, labelKey, language }) => {
    const copy = relationshipCopy(language);
    const invite = invitationCopy(language);
    if (card.isPrimary || labelKey === 'Owner') {
        return (
            <>
                <p className="m-0 text-[13.5px] font-semibold text-stone-700" data-testid="relationship-plots">{copy.cards.plotsLabel}: {copy.allPlots}</p>
                <p className="m-0 text-[13.5px] font-semibold text-stone-700" data-testid="relationship-owner-all">{copy.cards.ownerAll}</p>
            </>
        );
    }
    const plotScope = card.plotsLine === copy.allPlots ? 'AllPlots' : card.plotNames.length > 0 ? 'ChosenPlots' : 'OwnWork';
    const lines = cardLines(
        { label: labelKey as InvitationLabel, plotScope, plotNames: card.plotNames, authorities: toGrants(card.authorities) },
        invite,
        language,
    );
    const end = card.near ? copy.cards.until(dayOf(card.near, language)) : null;
    return (
        <>
            <p className="m-0 text-[13.5px] font-semibold text-stone-700" data-testid="relationship-plots">
                {plotScope === 'ChosenPlots' ? `${copy.cards.plotsLabel}: ${card.plotNames.join(', ')}` : plotScope === 'AllPlots' ? `${copy.cards.plotsLabel}: ${copy.allPlots}` : copy.ownWork}
            </p>
            <p className="m-0 text-[13.5px] font-semibold text-stone-700" data-testid="relationship-authorities">
                {lines.authorities.length > 0 ? lines.authorities.join(' · ') : copy.cards.noAuthorities}
            </p>
            {end && <p className="m-0 text-[13px] font-extrabold text-amber-800" data-testid="relationship-until">{end}</p>}
        </>
    );
};

function toGrants(authorities: readonly MeAuthority[]): { name: string; expiresAtUtc: string | null }[] {
    return authorities.map(a => ({ name: a.name, expiresAtUtc: a.expiresAtUtc }));
}

export default MyResponsibilities;
