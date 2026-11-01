using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.UseCases.RecordPrivacy.SetRecordAudience;

/// <summary>
/// spec: plr-d10 lane PRV (founder D-26) — the primary account holder narrows (or widens back) who sees one record.
/// <list type="number">
/// <item><b>Shape.</b> A known kind and audience; <see cref="RecordAudience.Selected"/> names at least one person and no
/// other audience names anyone.</item>
/// <item><b>The record</b>, read under the scope the caller set (a record of another farm resolves to nothing).</item>
/// <item><b>The sender is the registrant OF THAT RECORD'S FARM</b> (D-26; fix pass 1, L2 — the record holder, the same rule
/// membership decisions use) — never a co-owner, never a second PrimaryOwner seat, never a claim in the payload.</item>
/// <item><b>Every chosen person holds an Active seat on that same farm</b> (E4, tenancy both ways: the record's farm AND
/// each person's farm, checked here in code; an FK or RLS alone proves nothing).</item>
/// <item><b>The record's state</b>: a job card's payout follows its job card (planned work is not in this release), so
/// its audience is not set here.</item>
/// </list>
/// Then the record's audience moves (past every phone's cursor), its chosen people are replaced, a work record's own
/// money follows it (the money its lines made, found by <see cref="RecordFirstMoney"/>), and ONE append-only audit row
/// per record says who, when, from → to (the people before and after). Nothing the record SAYS changes: no content, no
/// version, no confirmation, no correction (P3: "hiding a practice must not rewrite shared evidence"). The same choice
/// sent again changes nothing and writes nothing.
/// </summary>
public sealed class SetRecordAudienceHandler(
    IShramSafalRepository repository,
    IClock clock,
    ILogger<SetRecordAudienceHandler> logger)
{
    public const string ChangedAction = "AudienceChanged";

    /// <summary>At most this many people may be chosen for one record.</summary>
    public const int MaxSelected = 50;

    public async Task<Result<SetRecordAudienceResultDto>> HandleAsync(SetRecordAudienceCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var selected = (command.SelectedUserIds ?? []).ToList();
        if (!RecordKinds.IsKnown(command.RecordKind) || command.RecordId == Guid.Empty || command.ActorUserId == Guid.Empty
            || !Enum.IsDefined(command.Audience)
            || selected.Any(id => id == Guid.Empty) || selected.Distinct().Count() != selected.Count || selected.Count > MaxSelected
            || (command.Audience == RecordAudience.Selected) != (selected.Count > 0))
        {
            return Result.Failure<SetRecordAudienceResultDto>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        Domain.Logs.DailyLog? log = null;
        CostEntry? entry = null;
        if (command.RecordKind == RecordKinds.DailyLog)
        {
            log = await repository.GetDailyLogForChangeAsync(command.RecordId, ct);
        }
        else
        {
            entry = await repository.GetCostEntryByIdAsync(command.RecordId, ct);
        }

        if (log is null && entry is null)
        {
            return Result.Failure<SetRecordAudienceResultDto>(
                command.RecordKind == RecordKinds.DailyLog ? ShramSafalErrors.DailyLogNotFound : ShramSafalErrors.CostEntryNotFound);
        }

        var farmId = log is not null ? (Guid)log.FarmId : (Guid)entry!.FarmId;
        // Fix pass 1 (L2) — the record holder is the farm's registrant (ManageMembershipHandler's rule), never a second
        // PrimaryOwner seat.
        if (await repository.GetFarmAccessForUserAsync(farmId, command.ActorUserId, ct) is not { IsRegistrant: true })
        {
            logger.LogWarning("set_record_audience for {Kind} {RecordId} refused: the sender is not the farm's registrant.",
                command.RecordKind, command.RecordId);
            return Result.Failure<SetRecordAudienceResultDto>(ShramSafalErrors.RecordAudienceNotHolder);
        }

        // E4 — each chosen person on THIS farm, Active (or the registrant), checked here in code.
        foreach (var userId in selected)
        {
            if (!FarmAccessPolicy.MayRead(await repository.GetFarmAccessForUserAsync(farmId, userId, ct)))
            {
                logger.LogWarning("set_record_audience for {Kind} {RecordId} refused: a chosen person holds no active seat on its farm.",
                    command.RecordKind, command.RecordId);
                return Result.Failure<SetRecordAudienceResultDto>(ShramSafalErrors.RecordAudienceStranger);
            }
        }

        if (entry is not null && IsJobCardPayout(entry))
        {
            logger.LogWarning("set_record_audience for money {RecordId} refused: a job card's payout follows its job card.", entry.Id);
            return Result.Failure<SetRecordAudienceResultDto>(ShramSafalErrors.RecordAudienceNotSettable);
        }

        var before = log?.Audience ?? entry!.Audience;
        var beforeSelected = (await repository.GetRecordAudienceUserIdsAsync(command.RecordKind, command.RecordId, ct)).ToHashSet();
        if (before == command.Audience && beforeSelected.SetEquals(selected))
        {
            // The same choice again (a replay from another device, a second tap): nothing moves, nothing is written.
            return Result.Success(new SetRecordAudienceResultDto(
                command.RecordKind, command.RecordId, before.ToString(), [.. beforeSelected.Order()],
                log?.AudienceChangedAtUtc ?? entry!.AudienceChangedAtUtc ?? now, 0, Changed: false));
        }

        // The record's own money follows a work record (found from its own lines; same farm only — E4) only while it is
        // FOLLOWING that record (fix pass 2, M2): its audience was never set on its own, or its newest audience change was a
        // follow of THIS record (FollowsRecordAsync). Money the holder set on its own keeps his choice through any later
        // change of the record — a coincidental match of audiences is never "following". Fix pass 1's test stays as a
        // second guard: money that follows has the record's audience before this change, and the same people.
        var money = new List<CostEntry>();
        if (log is not null)
        {
            var lines = await RecordFirstMoney.OfAsync(repository, log, logger, ct);
            foreach (var candidate in (await repository.GetCostEntriesByIdsAsync(lines.LookFor, ct))
                         .Where(e => e.FarmId == log.FarmId && !IsJobCardPayout(e) && e.Audience == before))
            {
                var candidatePeople = (await repository.GetRecordAudienceUserIdsAsync(RecordKinds.CostEntry, candidate.Id, ct)).ToHashSet();
                if (candidatePeople.SetEquals(beforeSelected) && await FollowsRecordAsync(candidate.Id, log.Id, ct))
                {
                    money.Add(candidate);
                }
            }
        }

        DateTime changedAt;
        if (log is not null)
        {
            log.SetAudience(command.Audience, now);
            changedAt = log.AudienceChangedAtUtc!.Value;
        }
        else
        {
            entry!.SetAudience(command.Audience, now);
            changedAt = entry.AudienceChangedAtUtc!.Value;
        }

        await repository.ReplaceRecordAudienceMembersAsync(farmId, command.RecordKind, command.RecordId, selected, now, ct);
        await AuditAsync(command, command.RecordKind, command.RecordId, farmId, before, beforeSelected, selected, followed: null, ct);

        foreach (var moneyEntry in money)
        {
            var moneyBefore = moneyEntry.Audience;
            var moneyBeforeSelected = (await repository.GetRecordAudienceUserIdsAsync(RecordKinds.CostEntry, moneyEntry.Id, ct)).ToHashSet();
            moneyEntry.SetAudience(command.Audience, now);
            await repository.ReplaceRecordAudienceMembersAsync(farmId, RecordKinds.CostEntry, moneyEntry.Id, selected, now, ct);
            await AuditAsync(command, RecordKinds.CostEntry, moneyEntry.Id, farmId, moneyBefore, moneyBeforeSelected, selected,
                followed: command.RecordId, ct);
        }

        await repository.SaveChangesAsync(ct);
        logger.LogInformation(
            "set_record_audience: {Kind} {RecordId} {From} -> {To} ({People} chosen); {Money} money entr(ies) followed.",
            command.RecordKind, command.RecordId, before, command.Audience, selected.Count, money.Count);

        return Result.Success(new SetRecordAudienceResultDto(
            command.RecordKind, command.RecordId, command.Audience.ToString(), [.. selected.Order()], changedAt, money.Count, Changed: true));
    }

    /// <summary>
    /// Fix pass 2 (M2) — is this money FOLLOWING the record <paramref name="recordId"/>? Read from the money's own
    /// audience trail, the append-only <c>AudienceChanged</c> rows this handler writes in the SAME unit of work as every
    /// change (the app role can neither update nor delete <c>ssf.audit_events</c>): no row at all = its audience was
    /// never set on its own (Team since it was made, or born with this record's audience — <c>RecordMoneyAudience</c>),
    /// so it follows; otherwise it follows only when its NEWEST row is a follow of this record (<c>followedRecordId</c>).
    /// A row the holder wrote for the money itself (followedRecordId null) ends the following for good.
    /// </summary>
    private async Task<bool> FollowsRecordAsync(Guid moneyId, Guid recordId, CancellationToken ct)
    {
        var newest = (await repository.GetAuditEventsForEntityAsync(moneyId, RecordKinds.CostEntry, ct))
            .Where(a => a.Action == ChangedAction)
            .OrderBy(a => a.OccurredAtUtc)
            .LastOrDefault();
        if (newest is null)
        {
            return true;
        }

        try
        {
            using var payload = System.Text.Json.JsonDocument.Parse(newest.Payload);
            return payload.RootElement.TryGetProperty("followedRecordId", out var followed)
                && followed.ValueKind == System.Text.Json.JsonValueKind.String
                && followed.TryGetGuid(out var followedId)
                && followedId == recordId;
        }
        catch (System.Text.Json.JsonException ex)
        {
            // A trail row that cannot be read is never taken as "following": the money keeps its audience (never widened).
            logger.LogWarning(ex, "set_record_audience: the audience trail of money {MoneyId} cannot be read; it does not follow.", moneyId);
            return false;
        }
    }

    /// <summary>A job card's payout (its own category, or made by settling a job card) follows the job card.</summary>
    private static bool IsJobCardPayout(CostEntry entry) =>
        entry.JobCardId is not null || string.Equals(entry.CategoryId, "labour_payout", StringComparison.Ordinal);

    private async Task AuditAsync(
        SetRecordAudienceCommand command,
        string kind,
        Guid recordId,
        Guid farmId,
        RecordAudience from,
        IReadOnlyCollection<Guid> fromSelected,
        IReadOnlyCollection<Guid> toSelected,
        Guid? followed,
        CancellationToken ct)
    {
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: kind,
                entityId: recordId,
                action: ChangedAction,
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    recordKind = kind,
                    recordId,
                    from = from.ToString(),
                    to = command.Audience.ToString(),
                    fromPeople = fromSelected.Order().ToList(),
                    toPeople = toSelected.Order().ToList(),
                    followedRecordId = followed,
                    phoneChangedAtUtc = command.ChangedOnPhoneAtUtc,
                },
                farmId: farmId,
                clientCommandId: command.ClientRequestId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash),
            ct);
    }
}
