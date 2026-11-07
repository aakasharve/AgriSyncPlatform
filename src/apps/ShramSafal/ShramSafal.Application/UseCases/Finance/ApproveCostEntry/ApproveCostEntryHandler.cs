using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.UseCases.Finance.ApproveCostEntry;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who and
/// when"). The ONE handler behind <c>approve_cost_entry</c> and <c>POST /shramsafal/finance/cost-entry/{id}/approve</c>.
///
/// <list type="number">
/// <item><b>Who may approve</b>: the farm's primary account holder, or a seat holding "पैशांच्या नोंदी तपासणे व दुरुस्त करणे"
/// (<see cref="FarmAuthority.ReviewMoney"/>, which needs see money) at this moment — the money book's one rule
/// (<c>CorrectCostEntryHandler</c>, D-89's payout check). Never the bill's maker as such, never a label.</item>
/// <item><b>Which bills</b>: one he may see (the audience, PRV) on a plot he covers, of the farm the phone named (E4). MU-4:
/// the read side's place rule for every seat it narrows (fix round 1, review H1: chosen plots AND an own-records seat — the
/// स्वतःचं काम scope or the कामगार label sees only his own money), then the write rule on the bill's plot. A bill he may not
/// see is "not found", exactly as a bill of another farm: no figure and no version in the answer.</item>
/// <item><b>His own bill</b>: approvable by a reviewer as built, behind <see cref="BillApprovalRules"/> (founder D-105 (a)).</item>
/// <item><b>Which version</b>: the one he saw. A bill corrected or moved since is refused with the L4b exact-version code
/// (<see cref="ShramSafalErrors.LogChangedSinceReview"/>) so the phone shows the new version first. The bill is read under
/// its row hold, so a correction in flight finishes first and this check sees the version it leaves.</item>
/// <item><b>The stamp</b>: a separate append-only row (who, when — the server's clock — and which version) plus its audit
/// row, in one save. The bill's figures, its flag and its history are untouched; approving clears "तपासायचे" for THIS
/// version only (<see cref="CostEntryReview"/>). A re-sent approval (same stamp id), or the same person approving the same
/// version again, is answered as it stands — never a second stamp.</item>
/// </list>
/// No entitlement gate (orchestrator-level call, BILL-1): reviewing money already recorded is never behind a trial, the same
/// as the payout check.
/// </summary>
public sealed class ApproveCostEntryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public const string ApprovedAction = "Approved";

    public async Task<Result<CostEntryDto>> HandleAsync(ApproveCostEntryCommand command, CancellationToken ct = default)
    {
        if (command.CostEntryId == Guid.Empty
            || command.ApprovedByUserId == Guid.Empty
            || command.BillVersion < 1
            || command.ApprovalId == Guid.Empty
            || command.FarmId == Guid.Empty)
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.InvalidCommand);
        }

        var entry = await repository.GetCostEntryForChangeAsync(command.CostEntryId, ct);
        if (entry is null || (command.FarmId is { } named && named != (Guid)entry.FarmId))
        {
            // E4 — a bill of another farm (or one the phone named on another farm) is not found, never refused by name.
            return Result.Failure<CostEntryDto>(ShramSafalErrors.CostEntryNotFound);
        }

        var farmId = (Guid)entry.FarmId;
        var caller = command.ApprovedByUserId;
        var now = clock.UtcNow;

        var role = await repository.GetUserRoleForFarmAsync(farmId, caller, ct);
        if (role is null)
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.Forbidden);
        }

        // MU-4 — fix round 1 (review H1): THE place rule the read side uses, for every seat it narrows (chosen plots, and an
        // own-records seat: the स्वतःचं काम scope or the कामगार label). A bill his pull never sends him is not there: not found,
        // exactly as a bill of another farm — no figure and no version reaches him.
        if (await CostEntryPlaceGate.HiddenFromAsync(repository, entry, caller, now, ct))
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.CostEntryNotFound);
        }

        // Then the write rule on the bill's plot (his own bill on a plot he does not cover: he sees it, D-28, and may not
        // approve it).
        if (await PlotScopeGate.RefuseAsync(repository, farmId, entry.PlotId, caller, now, ct) is { } outside)
        {
            return Result.Failure<CostEntryDto>(outside);
        }

        // PRV — a bill kept from him is not his to approve.
        if (!await RecordAudienceGate.MaySeeCostAsync(repository, entry, caller, now, ct))
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.RecordAudienceClosed);
        }

        // The money book's rule: the primary account holder, or review money at this moment.
        var isPrimaryHolder = await FarmAuthorityGate.IsPrimaryAccountHolderAsync(repository, farmId, caller, ct);
        if (!isPrimaryHolder
            && !await FarmAuthorityGate.HoldsAsync(repository, farmId, caller, FarmAuthority.ReviewMoney, now, ct))
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.Forbidden);
        }

        // D-105 (a), waiting for the founder: may a reviewer approve a bill he entered himself? As built until he answers.
        if (!BillApprovalRules.MayApproveOwnBill(isPrimaryHolder, entry.CreatedByUserId.Value == caller))
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.Forbidden);
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, caller, now, ct);

        var stamps = (await repository.GetCostEntryApprovalsAsync([entry.Id], ct))
            .Where(a => a.CostEntryId == entry.Id && a.FarmId == entry.FarmId)
            .ToList();

        // A re-sent approval is the stamp it already made (asked before the version: the bill may have moved on since).
        if (command.ApprovalId is { } resent && stamps.Any(a => a.Id == resent && a.ApprovedByUserId.Value == caller))
        {
            return Result.Success(await AnswerAsync(entry, stamps, scope, caller, ct));
        }

        // D-12 / D-46 §3 — the exact version he saw.
        if (command.BillVersion != entry.ContentVersion)
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.LogChangedSinceReview);
        }

        // One person, one version, one stamp.
        if (stamps.Any(a => a.ApprovedByUserId.Value == caller && a.BillVersion == entry.ContentVersion))
        {
            return Result.Success(await AnswerAsync(entry, stamps, scope, caller, ct));
        }

        var neededReview = CostEntryReview.NeedsReview(entry, stamps);
        var corrections = await repository.GetCorrectionsForEntriesAsync([entry.Id], ct);
        var effectiveAmount = corrections
            .Where(c => c.CostEntryId == entry.Id)
            .OrderBy(c => c.CorrectedAtUtc)
            .LastOrDefault()?.CorrectedAmount ?? entry.Amount;

        var appVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
            : command.ClientAppVersion;
        var approval = entry.Approve(
            command.ApprovalId ?? idGenerator.New(),
            new UserId(caller),
            command.BillVersion,
            now,
            command.ClientCommandId,
            appVersion);

        // Repository add methods only stage entities; the single SaveChangesAsync below commits the stamp, the bill's
        // forward clock and the audit row together.
        await repository.AddCostEntryApprovalAsync(approval, ct);
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "CostEntry",
                entityId: entry.Id,
                action: ApprovedAction,
                actorUserId: caller,
                actorRole: role.Value.ToString(),
                payload: new
                {
                    costEntryId = entry.Id,
                    approvalId = approval.Id,
                    billVersion = approval.BillVersion,
                    effectiveAmount,
                    entry.CurrencyCode,
                    clearedReview = neededReview,
                    reviewReason = CostEntryReview.ReasonOf(entry, stamps),
                },
                farmId: entry.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: appVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(await AnswerAsync(entry, [.. stamps, approval], scope, caller, ct));
    }

    /// <summary>The bill as the pull would send it to him, with its review state and latest stamp.</summary>
    private async Task<CostEntryDto> AnswerAsync(
        CostEntry entry, IReadOnlyList<CostEntryApproval> stamps, FarmReadScope? scope, Guid caller, CancellationToken ct)
    {
        var latest = CostEntryReview.Latest(entry, stamps);
        IReadOnlyDictionary<Guid, string> names = new Dictionary<Guid, string>();
        if (latest is not null && (latest.ApprovedByUserId.Value == caller || scope is { OwnRecordsOnly: false }))
        {
            names = (await repository.GetOperatorsByIdsAsync([latest.ApprovedByUserId.Value], ct))
                .GroupBy(o => o.UserId)
                .ToDictionary(g => g.Key, g => g.First().DisplayName);
        }

        return BillReviewProjection.WithReview(entry.ToDto(), entry, stamps, names);
    }
}
