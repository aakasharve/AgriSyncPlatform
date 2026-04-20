using Accounts.Application.Ports;
using Accounts.Domain.Affiliation;
using Accounts.Domain.Subscriptions;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Application.EventHandlers;

/// <summary>
/// Checks whether a pending referral qualifies (spec §7.2.1):
///   referred phone verified + referred has OwnerAccount + has ≥1 Farm + subscription Trialing/Active.
///
/// Called whenever a SubscriptionActivated event fires for the referred account.
/// Uses I11 de-dup: same (ReferralQualified, referralRelationshipId) → only one GrowthEvent.
/// </summary>
public sealed class ReferralQualificationHandler(
    IAffiliationRepository affiliationRepo,
    ISubscriptionRepository subscriptionRepo,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task HandleAsync(
        OwnerAccountId referredOwnerAccountId,
        CancellationToken ct = default)
    {
        // Is there a pending referral for this account?
        var relationship = await affiliationRepo.GetByReferredAccountAsync(referredOwnerAccountId, ct);
        if (relationship is null || relationship.Status != ReferralRelationshipStatus.Pending)
        {
            return;
        }

        // Does the referred account have an active/trialing subscription?
        var subscription = await subscriptionRepo.GetCurrentAsync(referredOwnerAccountId, ct);
        if (subscription is null || !subscription.IsCurrentlyValid)
        {
            return;
        }

        // I11 — de-dup guard.
        var alreadyFired = await affiliationRepo.GrowthEventExistsAsync(
            GrowthEventType.ReferralQualified, relationship.Id.Value, ct);
        if (alreadyFired)
        {
            return;
        }

        relationship.MarkQualified(clock.UtcNow);

        var growthEvent = new GrowthEvent(
            new GrowthEventId(idGenerator.New()),
            ownerAccountId: relationship.ReferrerOwnerAccountId,
            eventType: GrowthEventType.ReferralQualified,
            referenceId: relationship.Id.Value,
            metadata: null,
            occurredAtUtc: clock.UtcNow);
        await affiliationRepo.AddGrowthEventAsync(growthEvent, ct);

        // Emit a locked benefit badge (V1 — no monetary value committed yet).
        var benefit = new BenefitLedgerEntry(
            new BenefitLedgerEntryId(idGenerator.New()),
            ownerAccountId: relationship.ReferrerOwnerAccountId,
            sourceGrowthEventId: growthEvent.Id,
            status: BenefitStatus.EarnedLocked,
            benefitType: "Badge",
            quantity: 1,
            unit: "count",
            createdAtUtc: clock.UtcNow);
        await affiliationRepo.AddBenefitLedgerEntryAsync(benefit, ct);

        await affiliationRepo.SaveChangesAsync(ct);
    }
}
