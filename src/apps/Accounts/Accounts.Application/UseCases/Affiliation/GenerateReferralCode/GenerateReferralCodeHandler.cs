using Accounts.Application.Ports;
using Accounts.Domain.Affiliation;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Application.UseCases.Affiliation.GenerateReferralCode;

/// <summary>
/// Returns the caller's active referral code; creates a new one if none exists.
/// Idempotent — safe to call multiple times.
/// </summary>
public sealed class GenerateReferralCodeHandler(
    IAffiliationRepository affiliationRepo,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<GenerateReferralCodeResult>> HandleAsync(
        OwnerAccountId ownerAccountId,
        CancellationToken ct = default)
    {
        // Return existing active code if one already exists.
        var existing = await affiliationRepo.GetActiveCodeByOwnerAccountAsync(ownerAccountId, ct);
        if (existing is not null)
        {
            return Result.Success(new GenerateReferralCodeResult(existing.Code));
        }

        // Generate a new one.  Retry once on the extremely rare collision.
        var codeValue = ReferralCodeGenerator.Generate(idGenerator.New());
        var collision = await affiliationRepo.GetActiveCodeByValueAsync(codeValue, ct);
        if (collision is not null)
        {
            codeValue = ReferralCodeGenerator.Generate(idGenerator.New());
        }

        var code = new ReferralCode(
            new ReferralCodeId(idGenerator.New()),
            ownerAccountId,
            codeValue,
            clock.UtcNow);

        await affiliationRepo.AddReferralCodeAsync(code, ct);
        await affiliationRepo.SaveChangesAsync(ct);

        return Result.Success(new GenerateReferralCodeResult(code.Code));
    }
}

public sealed record GenerateReferralCodeResult(string Code);
