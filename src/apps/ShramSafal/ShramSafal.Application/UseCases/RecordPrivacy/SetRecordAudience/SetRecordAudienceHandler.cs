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

        // The record's own money (found from its own lines; same farm only — E4) and a change of the record (fix pass 3,
        // M-A, on fix pass 2's M2):
        //   - money FOLLOWING the record (its audience never set on its own, or its newest change a follow of THIS record)
        //     takes the record's new audience, never wider than the holder's own last choice for that money (MoneyTrail);
        //   - money the holder set on its own keeps his choice, EXCEPT that a narrowing of the record takes away from it
        //     everyone the record no longer admits (never adding anyone): after a record narrows, none of its line money
        //     is seen by someone who cannot see the record ("या कामाचा खर्चही याच लोकांना दिसेल").
        // Every move a record makes of its money is written as a follow of that record, so a later widening of the record
        // brings the money back with it — up to the holder's own last choice, never past it.
        var oldSet = AudienceSet.Of(before, beforeSelected);
        var newSet = AudienceSet.Of(command.Audience, selected);
        var narrows = !oldSet.Within(newSet);
        var money = new List<(CostEntry Entry, AudienceSet Before, AudienceSet After)>();
        if (log is not null)
        {
            var lines = await RecordFirstMoney.OfAsync(repository, log, logger, ct);
            foreach (var candidate in (await repository.GetCostEntriesByIdsAsync(lines.LookFor, ct))
                         .Where(e => e.FarmId == log.FarmId && !IsJobCardPayout(e)))
            {
                var current = AudienceSet.Of(
                    candidate.Audience, await repository.GetRecordAudienceUserIdsAsync(RecordKinds.CostEntry, candidate.Id, ct));
                var trail = await MoneyTrailAsync(candidate.Id, ct);
                var target = trail.Follows(log.Id)
                    ? trail.OwnChoice.Intersect(newSet)
                    : narrows ? current.Intersect(newSet) : current;
                if (!target.SameAs(current))
                {
                    money.Add((candidate, current, target));
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
        await AuditAsync(command, command.RecordKind, command.RecordId, farmId, before, beforeSelected, command.Audience, selected,
            followed: null, stampedAtUtc: changedAt, ct);

        foreach (var (moneyEntry, moneyBefore, moneyAfter) in money)
        {
            var afterPeople = moneyAfter.People.ToList();
            moneyEntry.SetAudience(moneyAfter.Audience, now);
            await repository.ReplaceRecordAudienceMembersAsync(farmId, RecordKinds.CostEntry, moneyEntry.Id, afterPeople, now, ct);
            await AuditAsync(command, RecordKinds.CostEntry, moneyEntry.Id, farmId, moneyBefore.Audience, moneyBefore.People.ToList(),
                moneyAfter.Audience, afterPeople, followed: command.RecordId, stampedAtUtc: moneyEntry.AudienceChangedAtUtc, ct);
        }

        await repository.SaveChangesAsync(ct);
        logger.LogInformation(
            "set_record_audience: {Kind} {RecordId} {From} -> {To} ({People} chosen); {Money} money entr(ies) followed.",
            command.RecordKind, command.RecordId, before, command.Audience, selected.Count, money.Count);

        return Result.Success(new SetRecordAudienceResultDto(
            command.RecordKind, command.RecordId, command.Audience.ToString(), [.. selected.Order()], changedAt, money.Count, Changed: true));
    }

    /// <summary>
    /// Fix pass 2 (M2) / fix pass 3 (M-A, item 4) — the money's own audience trail: the append-only <c>AudienceChanged</c>
    /// rows this handler writes in the SAME unit of work as every change (the app role can neither update nor delete
    /// <c>ssf.audit_events</c>), in a STABLE order: the record's own audience stamp written into each row
    /// (<c>stampedAtUtc</c> — <see cref="AudienceStamp"/>, strictly increasing per record), then the row's time, then its id
    /// (rows written before the stamp existed fall back to their time). From it: is the money FOLLOWING a record (no row
    /// at all, or the newest row a follow of that record), and the holder's own last choice for it (his newest own row;
    /// none = the whole team). An unreadable row ends the following and is read as Only me (never widened).
    /// </summary>
    private async Task<MoneyTrail> MoneyTrailAsync(Guid moneyId, CancellationToken ct)
    {
        var rows = (await repository.GetAuditEventsForEntityAsync(moneyId, RecordKinds.CostEntry, ct))
            .Where(a => a.Action == ChangedAction)
            .Select(a => (Row: a, Parsed: ParseTrailRow(a)))
            .OrderBy(x => x.Parsed?.StampedAtUtc ?? x.Row.OccurredAtUtc)
            .ThenBy(x => x.Row.OccurredAtUtc)
            .ThenBy(x => x.Row.Id)
            .ToList();
        if (rows.Count == 0)
        {
            return new MoneyTrail(HasRows: false, NewestFollowed: null, NewestUnreadable: false, OwnChoice: AudienceSet.Team);
        }

        var newest = rows[^1].Parsed;
        var own = rows.LastOrDefault(x => x.Parsed is { FollowedRecordId: null }).Parsed;
        var anyUnreadable = rows.Any(x => x.Parsed is null);
        return new MoneyTrail(
            HasRows: true,
            NewestFollowed: newest?.FollowedRecordId,
            NewestUnreadable: newest is null,
            OwnChoice: anyUnreadable ? AudienceSet.OnlyMe : own?.To ?? AudienceSet.Team);
    }

    private TrailRow? ParseTrailRow(Domain.Audit.AuditEvent row)
    {
        try
        {
            using var payload = System.Text.Json.JsonDocument.Parse(row.Payload);
            var root = payload.RootElement;
            Guid? followed = root.TryGetProperty("followedRecordId", out var f)
                && f.ValueKind == System.Text.Json.JsonValueKind.String && f.TryGetGuid(out var followedId)
                    ? followedId
                    : null;
            DateTime? stamped = root.TryGetProperty("stampedAtUtc", out var st)
                && st.ValueKind == System.Text.Json.JsonValueKind.String && st.TryGetDateTime(out var stampedAt)
                    ? stampedAt.ToUniversalTime()
                    : null;
            var to = root.TryGetProperty("to", out var t) && t.ValueKind == System.Text.Json.JsonValueKind.String
                && Enum.TryParse<RecordAudience>(t.GetString(), out var toAudience)
                    ? toAudience
                    : (RecordAudience?)null;
            if (to is null)
            {
                return null;
            }

            var toPeople = root.TryGetProperty("toPeople", out var tp) && tp.ValueKind == System.Text.Json.JsonValueKind.Array
                ? tp.EnumerateArray().Where(e => e.TryGetGuid(out _)).Select(e => e.GetGuid()).ToList()
                : [];
            return new TrailRow(followed, stamped, AudienceSet.Of(to.Value, toPeople));
        }
        catch (System.Text.Json.JsonException ex)
        {
            // An unreadable trail row is never taken as "following", and the money's own choice is read as Only me.
            logger.LogWarning(ex, "set_record_audience: an audience trail row {RowId} of money {MoneyId} cannot be read.", row.Id, row.EntityId);
            return null;
        }
    }

    private sealed record TrailRow(Guid? FollowedRecordId, DateTime? StampedAtUtc, AudienceSet To);

    private sealed record MoneyTrail(bool HasRows, Guid? NewestFollowed, bool NewestUnreadable, AudienceSet OwnChoice)
    {
        /// <summary>Following <paramref name="recordId"/>: never set at all, or its newest row a follow of it.</summary>
        public bool Follows(Guid recordId) => !HasRows || (!NewestUnreadable && NewestFollowed == recordId);
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
        RecordAudience to,
        IReadOnlyCollection<Guid> toSelected,
        Guid? followed,
        DateTime? stampedAtUtc,
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
                    to = to.ToString(),
                    fromPeople = fromSelected.Order().ToList(),
                    toPeople = toSelected.Order().ToList(),
                    followedRecordId = followed,
                    // Fix pass 3 (item 4) — the record's own audience stamp: the trail's stable order.
                    stampedAtUtc,
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
