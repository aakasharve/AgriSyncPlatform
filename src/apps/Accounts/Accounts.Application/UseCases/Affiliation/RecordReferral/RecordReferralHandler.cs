using Accounts.Application.Ports;
using Accounts.Domain.Affiliation;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Application.UseCases.Affiliation.RecordReferral;

/// <summary>
/// Records a referral relationship when a new farmer signs up using a referral code.
/// Called from <see cref="AgriSync.Bootstrapper.Endpoints.FirstFarmBootstrapEndpoints"/>
/// if a <c>referralCode</c> is supplied in the bootstrap request.
///
/// Invariants enforced:
///   I10 — only one ReferralRelationship per referred account.
///   I13 — self-referral rejected (referrer == referred by ownerAccountId).
/// </summary>
public sealed class RecordReferralHandler(
    IAffiliationRepository affiliationRepo,
    IOwnerAccountRepository ownerAccountRepo,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<RecordReferralResult>> HandleAsync(
        OwnerAccountId referredOwnerAccountId,
        string referralCode,
        CancellationToken ct = default)
    {
        // Already has a referral — idempotent, return success.
        if (await affiliationRepo.ReferralRelationshipExistsAsync(referredOwnerAccountId, ct))
        {
            return Result.Success(new RecordReferralResult(WasRecorded: false, WasDuplicate: true));
        }

        // Resolve the referral code.
        var code = await affiliationRepo.GetActiveCodeByValueAsync(referralCode, ct);
        if (code is null)
        {
            return Result.Success(new RecordReferralResult(WasRecorded: false, WasDuplicate: false));
        }

        // I13 — self-referral guard.
        if (code.OwnerAccountId == referredOwnerAccountId)
        {
            return Result.Success(new RecordReferralResult(WasRecorded: false, WasDuplicate: false));
        }

        var relationship = new ReferralRelationship(
            new ReferralRelationshipId(idGenerator.New()),
            referrerOwnerAccountId: code.OwnerAccountId,
            referredOwnerAccountId: referredOwnerAccountId,
            referralCodeId: code.Id,
            createdAtUtc: clock.UtcNow);

        await affiliationRepo.AddReferralRelationshipAsync(relationship, ct);

        // Seed an initial GrowthEvent for the referrer so the ledger trail starts.
        var alreadyFired = await affiliationRepo.GrowthEventExistsAsync(
            GrowthEventType.FarmerReferred, relationship.Id.Value, ct);
        if (!alreadyFired)
        {
            var evt = new GrowthEvent(
                new GrowthEventId(idGenerator.New()),
                ownerAccountId: code.OwnerAccountId,
                eventType: GrowthEventType.FarmerReferred,
                referenceId: relationship.Id.Value,
                metadata: null,
                occurredAtUtc: clock.UtcNow);
            await affiliationRepo.AddGrowthEventAsync(evt, ct);
        }

        await affiliationRepo.SaveChangesAsync(ct);

        return Result.Success(new RecordReferralResult(WasRecorded: true, WasDuplicate: false));
    }
}

public sealed record RecordReferralResult(bool WasRecorded, bool WasDuplicate);
