using System.Globalization;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Logs.MoveDailyLog;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1, D-61 = 5A) — "प्लॉट बदला" /
/// "दिवस बदला" on a SAVED record reaches the server, queued like every other change (doctrine P10).
///
/// <list type="bullet">
/// <item><b>Who may</b> — the ONE rule for changing a saved record (<see cref="LogEditGate"/>, the rule
/// <c>revise_log_content</c> uses). Anyone else: refused, nothing written.</item>
/// <item><b>Where it may go</b> — every plot is read under the farm's tenant scope AND checked against the record's
/// farm in this code (E4: an FK or RLS alone proves nothing); a foreign plot is <c>Forbidden</c>, never NotFound. A
/// single-plot record carries its crop season: the season on the target plot that covers the target day, or the
/// move is refused (<see cref="ShramSafalErrors.LogMoveNoCropCycle"/>).</item>
/// <item><b>When</b> — never a day after the farm's today (<see cref="LogDayRule.IsAfterFarmToday"/>; the move is sent
/// only by the new app, the day picked by tapping).</item>
/// <item><b>Never over a newer change</b> — the row is held for this change (<c>GetDailyLogForChangeAsync</c>) and a
/// move made from an older version is refused (<see cref="ShramSafalErrors.LogMoveStale"/>).</item>
/// <item><b>What moves with it</b> — the record keeps its id, so everything hanging off it by <c>daily_log_id</c>
/// (task lines, content versions, labour engagements and their stated money, verification history, irrigation,
/// machinery, disturbance rows) moves without being touched. The COPIES of its place or day that follow it: a named
/// person's work row (<see cref="FieldOperatorWorkRow.WorkDate"/>), the plot on an observation made from it
/// (<see cref="Domain.Farms.ObservationEvent.PlotId"/>), and the money entries the phone made from its lines
/// (<see cref="CostEntry"/>; the amount never changes, P7) — found by recomputing their ids from this record's id and
/// the line ids the server holds (<see cref="MoneyEntryIdentity"/>), never by matching amounts and never from a list a
/// phone sends (fix pass 4: the server alone decides). Money found for ANY line of the record moves — a line of its
/// create-time details or of a later version — so money a later edit makes (F89) follows too. A
/// money entry takes the new plot (none for several plots / the whole farm) only when the PLACE changes, and the new
/// day only when the day changes AND it was dated on the record's old day (fix pass 2, N2: phones up to 1.0.17 dated a
/// record's money on the day it was SAVED, which is often not the record's day; lane OF-M F88 dates new money on the
/// record's day); its season is the one season on its plot that covers its own day (<see cref="RecordMoneyPlace"/>, the
/// phone's rule <c>resolveMoneyPlace</c>). The answer lists exactly the money moved
/// (<see cref="MoveDailyLogResultDto"/>), and the phone moves nothing else (N1).</item>
/// <item><b>Copies left as they were, on purpose</b> (fix pass 1, B010) — the typed ledger rows derived at capture
/// (<c>farm_operations</c>: their identity, <c>DerivedEventKey</c>, contains the capture plot, so rewriting it would make
/// a later re-confirm of the same capture duplicate instead of supersede); the weather reading (<c>weather_stamps</c>: a
/// fact about where and when the weather was read); a DFES question shown to him (<c>question_events</c>: what he was
/// asked, about which plot, when); a task line's compliance verdict (immutable once stamped, I-17); the routine pattern
/// (a count with no link back to which record fed it). None of them is read by a farmer screen or the pull, and the DFES
/// day totals rebuilt below read the record's children by <c>daily_log_id</c> — never a copied day.</item>
/// <item><b>What refuses a move</b> (CTO call, lane OF-S; widened in fix passes 1, 2 and 4), each with its own plain
/// reason (item 9) and each refusing it WHOLE — nothing changes:
/// <list type="bullet">
/// <item>ANY live job card linked to the record (every one, never the first found), or its money being a card's payout
/// (<see cref="ShramSafalErrors.LogMoveJobCard"/>);</item>
/// <item>the server never held the record's details as it was CREATED (a 1.0.15–1.0.17 voice save, or a create whose
/// details did not fit and stayed on the phone): it cannot tell which of its lines made money, so nobody can show its
/// money follows (<see cref="ShramSafalErrors.LogMoveDetailsNotHeld"/>; fix pass 4 — no phone can unlock it). Every
/// record this build makes outside the हजेरी door carries its details, even when empty (R3-2);</item>
/// <item>a line that STATED an amount whose money cannot be found by its derived id — saved the old way, kept on the
/// phone, or not arrived yet (<see cref="ShramSafalErrors.LogMoveMoneyNotFound"/>). The stated lines are: a crew with a
/// stated total; an input, machinery or expense line with an amount in the record's create-time details. A line priced by
/// a later edit never blocks: the edit made its money itself (lane OF-M, at the record's place then), and where it could
/// not, the edit's answer said why. A line with no stated amount expects no money and never blocks. The refusal NAMES the
/// money it could not find (<c>[money:&lt;id&gt;,…]</c> at the end of its message, lane OF-M R4-1), so the phone looks at
/// exactly that money;</item>
/// <item>its money already shared out across plots by an allocation (<see cref="ShramSafalErrors.LogMoveMoneyShared"/>);</item>
/// <item>a हजेरी ruling on the OLD day for a person named on this record's labour, or an ABSENT ruling on the NEW day
/// for one (<see cref="ShramSafalErrors.LogMoveAttendance"/>). A place-only move is not stopped by हजेरी: a ruling is
/// about a person on a DAY and names no plot.</item>
/// </list></item>
/// <item><b>History, never silent mutation (P3)</b> — current truth is the record row; the move is kept as ONE
/// append-only audit row (<c>DailyLog</c> / <c>LogMoved</c>: old place and day → new, who, when, why, versions). The
/// AI-parse correction ledger (<c>CorrectionEvent</c>) is deliberately NOT used: it is keyed on a parse, scoped to a
/// user rather than a farm and feeds the golden set (doctrine E7).</item>
/// <item><b>It re-opens a confirmed day</b> exactly as a content revision does (<see cref="MaterialChangeReopen"/>).</item>
/// <item><b>Replays are free</b> — the sync store answers a repeated request id from the stored result; a move to
/// where the record already is writes nothing.</item>
/// </list>
/// </summary>
public sealed class MoveDailyLogHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    ILogger<MoveDailyLogHandler> logger,
    // The day aggregates (DFES) of the OLD and the NEW day are recomputed after the move, the same non-blocking
    // side-car the create path runs. Optional so direct-construction tests compile; without it nothing is recomputed.
    IDailyRichnessDerivationService? dailyRichnessDerivation = null,
    DbContext? dbContext = null)
    : IHandler<MoveDailyLogCommand, MoveDailyLogResultDto>
{
    /// <summary>The audit action of the one ledger row a move writes.</summary>
    public const string MovedAction = "LogMoved";

    public async Task<Result<MoveDailyLogResultDto>> HandleAsync(MoveDailyLogCommand command, CancellationToken ct = default)
    {
        // ── 1. Shape. Nothing is read yet. ─────────────────────────────────────────────────────
        var newPlotIds = command.NewPlotIds?.ToArray();
        if (command.DailyLogId == Guid.Empty || command.ActorUserId == Guid.Empty || command.BaseVersion < 1
            || (newPlotIds is not null && (newPlotIds.Length == 0 || command.WholeFarm
                || newPlotIds.Any(id => id == Guid.Empty) || newPlotIds.Distinct().Count() != newPlotIds.Length))
            || (newPlotIds is null && !command.WholeFarm && command.NewLogDate is null)
            || command.Reason is { Length: > 400 })
        {
            return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.InvalidCommand);
        }

        // ── 2. The record, held for this change (a second change waits and then sees this one). ───
        var log = await repository.GetDailyLogForChangeAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var now = clock.UtcNow;
        if (await LogEditGate.CheckAsync(repository, entitlementPolicy, log, command.ActorUserId, now, ct) is { } refusal)
        {
            logger.LogWarning("move_daily_log for {LogId} refused: {Code}.", log.Id, refusal.Code);
            return Result.Failure<MoveDailyLogResultDto>(refusal);
        }

        // ── 3. When. ───────────────────────────────────────────────────────────────────────────
        var targetDate = command.NewLogDate ?? log.LogDate;
        if (command.NewLogDate is { } chosenDay && LogDayRule.IsAfterFarmToday(chosenDay, now))
        {
            logger.LogWarning("move_daily_log for {LogId} refused: {Day} is after the farm's today.", log.Id, chosenDay);
            return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogDateInFuture);
        }

        // ── 4. Where. Every plot read under the farm scope AND checked against the record's farm (E4). ───
        DailyLogScope scope;
        Guid[] targetPlots;
        if (command.WholeFarm)
        {
            scope = DailyLogScope.Farm;
            targetPlots = [];
        }
        else if (newPlotIds is not null)
        {
            foreach (var plotId in newPlotIds)
            {
                var plot = await repository.GetPlotByIdAsync(plotId, ct);
                if (plot is null || plot.FarmId != log.FarmId)
                {
                    logger.LogWarning("move_daily_log for {LogId} refused: a chosen plot is not on the record's farm.", log.Id);
                    return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.Forbidden);
                }
            }

            scope = newPlotIds.Length == 1 ? DailyLogScope.Plot : DailyLogScope.MultiPlot;
            targetPlots = newPlotIds;
        }
        else
        {
            scope = log.Scope;
            targetPlots = log.PlotIds.ToArray();
        }

        Guid? singlePlot = scope == DailyLogScope.Plot ? targetPlots[0] : null;
        Guid? cropCycleId = null;
        if (singlePlot is { } onePlot)
        {
            cropCycleId = await CycleCoveringAsync(log, onePlot, targetDate, ct);
            if (cropCycleId is null)
            {
                logger.LogWarning("move_daily_log for {LogId} refused: no crop season on the plot covers {Day}.", log.Id, targetDate);
                return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveNoCropCycle);
            }
        }

        // Already there: nothing to move, nothing written, no version, no re-open.
        if (log.IsPlacedAt(scope, targetPlots, cropCycleId, targetDate))
        {
            return Result.Success(await AnswerAsync(log, [], command.ActorUserId, now, ct));
        }

        // ── 5. Never over a newer change. ───────────────────────────────────────────────────────
        if (command.BaseVersion < log.ContentVersion)
        {
            logger.LogInformation(
                "move_daily_log for {LogId} refused as stale: made from version {Base}, the record is at {Current}.",
                log.Id, command.BaseVersion, log.ContentVersion);
            return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveStale);
        }

        // ── 6. What is tied to it and cannot follow. Still nothing staged. ────────────────────
        // Every linked card (fix 1, B003): nothing makes the link unique, and a cancelled card must not hide a paid one.
        var liveCard = (await repository.GetJobCardsByLinkedDailyLogIdAsync(log.Id, ct))
            .FirstOrDefault(card => card.Status != JobCardStatus.Cancelled);
        if (liveCard is not null)
        {
            logger.LogWarning("move_daily_log for {LogId} refused: job card {JobCardId} ({Status}) is linked to it.",
                log.Id, liveCard.Id, liveCard.Status);
            return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveJobCard);
        }

        // Its money (fix 1, B002; fixes 2 and 4, orchestrator calls — the server alone decides): every entry made from
        // its lines, found by derived id; every line its create-time details priced must have one (P4).
        var lines = await RecordFirstMoney.OfAsync(repository, log, logger, ct);

        // fix 4 (R3-1, R3-4) — without the record's create-time details the server cannot tell which lines made money,
        // so nobody can show its money follows: refused whole, from every phone, rather than leave money behind.
        if (!lines.HeldFromCreate)
        {
            logger.LogWarning("move_daily_log for {LogId} refused: the server never held its details as it was created.", log.Id);
            return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveDetailsNotHeld);
        }

        var money = (await repository.GetCostEntriesByIdsAsync(lines.LookFor, ct))
            .Where(entry => entry.FarmId == log.FarmId) // E4: never another farm's row
            .ToList();
        var missing = lines.Stated.Where(id => money.All(entry => entry.Id != id)).OrderBy(id => id).ToList();
        if (missing.Count > 0)
        {
            logger.LogWarning("move_daily_log for {LogId} refused: the money of {Missing} stated line(s) was not found.", log.Id, missing.Count);
            // lane OF-M (R4-1) — the existing refusal shape carries the missing money: same code, its message ends with
            // the ids, so the phone's words look at exactly those rows (only this build's phones send a move).
            return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveMoneyNotFound with
            {
                Description = $"{ShramSafalErrors.LogMoveMoneyNotFound.Description} [money:{string.Join(",", missing.Select(id => id.ToString("D")))}]",
            });
        }

        foreach (var entry in money)
        {
            if (entry.JobCardId is not null)
            {
                logger.LogWarning("move_daily_log for {LogId} refused: its money entry {CostEntryId} is a job card's payout.", log.Id, entry.Id);
                return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveJobCard);
            }

            if (await repository.GetDayLedgerBySourceCostEntryIdAsync(entry.Id, ct) is not null)
            {
                logger.LogWarning("move_daily_log for {LogId} refused: its money entry {CostEntryId} is shared out across plots.", log.Id, entry.Id);
                return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveMoneyShared);
            }
        }

        var dayChanges = targetDate != log.LogDate;
        var placeChanges = scope != log.Scope || !targetPlots.OrderBy(id => id).SequenceEqual(log.PlotIds.OrderBy(id => id));
        var workRows = new List<FieldOperatorWorkRow>();
        if (dayChanges)
        {
            var assignments = await repository.GetLabourAssignmentsForDailyLogsAsync([log.Id], ct);
            foreach (var assignment in assignments)
            {
                // E4 — a work row can carry a farm other than its log's (permissive policy, FK bypasses RLS).
                workRows.AddRange((await repository.GetFieldOperatorWorkRowsForAssignmentAsync(assignment.Id, ct))
                    .Where(r => r.FarmId == log.FarmId));
            }

            foreach (var operatorId in workRows.Select(r => r.FieldOperatorId).Distinct())
            {
                if (await repository.GetAttendanceMarkAsync(log.FarmId, operatorId, log.LogDate, ct) is not null)
                {
                    logger.LogWarning("move_daily_log for {LogId} refused: a हजेरी ruling on {Day} names a person on it.",
                        log.Id, log.LogDate);
                    return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveAttendance);
                }

                // fix 1 (B008) — marked ABSENT on the new day: a work row there would contradict the ruling (the
                // contradiction RecordAttendanceMarkHandler refuses). A present ruling there agrees and is fine.
                if (await repository.GetAttendanceMarkAsync(log.FarmId, operatorId, targetDate, ct) is { Day: DayMark.Absent })
                {
                    logger.LogWarning("move_daily_log for {LogId} refused: a person on it is marked absent on {Day}.",
                        log.Id, targetDate);
                    return Result.Failure<MoveDailyLogResultDto>(ShramSafalErrors.LogMoveAttendance);
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════════════
        // STAGING BEGINS. Everything above refused with nothing staged; everything below writes.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        var from = Placement(log);
        var fromDay = log.LogDate;
        var fromVersion = log.ContentVersion;

        log.MoveTo(scope, targetPlots, singlePlot, cropCycleId, targetDate, now);
        foreach (var row in workRows)
        {
            row.FollowEngagementToDay(targetDate);
        }

        // fix 2 (N2) — a plot-only move never touches a money entry's day; a day move shifts only the money dated on the
        // record's OLD day. An entry neither change reaches is not moved and not listed.
        var moneyMoved = new List<object>(money.Count);
        var movedMoney = new List<CostEntry>(money.Count);
        foreach (var entry in money)
        {
            var plot = placeChanges ? singlePlot : entry.PlotId;
            var day = dayChanges && entry.EntryDate == fromDay ? targetDate : entry.EntryDate;
            if (plot == entry.PlotId && day == entry.EntryDate)
            {
                continue;
            }

            moneyMoved.Add(new
            {
                costEntryId = entry.Id,
                fromPlotId = entry.PlotId,
                fromCropCycleId = entry.CropCycleId,
                fromEntryDate = entry.EntryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            });
            entry.FollowRecord(plot, plot is { } onIt ? await RecordMoneyPlace.SeasonAsync(repository, (Guid)log.FarmId, onIt, day, ct) : null, day, now);
            movedMoney.Add(entry);
        }

        IReadOnlyList<Domain.Farms.ObservationEvent> observations = placeChanges
            ? await repository.GetObservationEventsForChangeAsync(log.Id, ct)
            : [];
        foreach (var observation in observations)
        {
            observation.FollowRecordToPlot(singlePlot);
        }

        var isCreator = command.ActorUserId == log.OperatorUserId.Value;
        var actorRole = await repository.GetUserRoleForFarmAsync((Guid)log.FarmId, command.ActorUserId, ct);
        var reopen = MaterialChangeReopen.Apply(log, command.ActorUserId, actorRole, isCreator, now, idGenerator);

        var appVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
            : command.ClientAppVersion;

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "DailyLog",
                entityId: log.Id,
                action: MovedAction,
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    logId = log.Id,
                    from,
                    to = Placement(log),
                    fromVersion,
                    toVersion = log.ContentVersion,
                    baseVersion = command.BaseVersion,
                    workRowsMoved = workRows.Count,
                    moneyMoved,
                    observationsMoved = observations.Count,
                    reason = command.Reason,
                    phoneMovedAtUtc = command.RevisedAtUtc,
                },
                farmId: (Guid)log.FarmId,
                clientCommandId: command.ClientRequestId,
                appVersion: appVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        if (reopen.ReOpen is not null)
        {
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "DailyLog",
                    entityId: log.Id,
                    action: "VerificationChanged",
                    actorUserId: command.ActorUserId,
                    actorRole: command.ActorRole ?? "unknown",
                    payload: new
                    {
                        logId = log.Id,
                        from = reopen.PriorStatus.ToString(),
                        to = log.CurrentVerificationStatus.ToString(),
                        trigger = MovedAction,
                        toVersion = log.ContentVersion,
                        reAttestedByCreator = reopen.ReAttested,
                        role = reopen.ReAttestedRole,
                        autoSavedFromVoice = log.WasAutoSavedFromVoice,
                    },
                    farmId: (Guid)log.FarmId,
                    clientCommandId: command.ClientRequestId,
                    appVersion: appVersion,
                    deviceId: command.AuditDeviceId,
                    ipHash: command.AuditIpHash,
                    sourceAiJobId: null),
                ct);
        }

        await repository.SaveChangesAsync(ct);

        logger.LogInformation(
            "move_daily_log moved {LogId} from {FromDay} to {ToDay} ({Scope}); version {FromVersion} -> {ToVersion}; {Rows} work row(s) followed.",
            log.Id, fromDay, targetDate, scope, fromVersion, log.ContentVersion, workRows.Count);

        // The day the record left (fix 2, N5: left empty, it is cleared to a day that never had a record), and the day it
        // is on now — also after a plot-only move, whose day reads the record's plot (the weather check).
        if (dayChanges)
        {
            await RecomputeDayAsync((Guid)log.FarmId, fromDay, ct);
        }

        await RecomputeDayAsync((Guid)log.FarmId, targetDate, ct);

        return Result.Success(await AnswerAsync(log, movedMoney.Select(entry => entry.ToDto()).ToList(), command.ActorUserId, now, ct));
    }

    /// <summary>
    /// lane MU-3 fix 1 (F5) — the answer as the PULL would send it to the mover: the record through
    /// <see cref="ReadScopeProjection.Record"/>, and the moved money only to a mover who sees money (the phone
    /// stores what it is given, so nothing withheld may ride an answer).
    /// </summary>
    private async Task<MoveDailyLogResultDto> AnswerAsync(
        Domain.Logs.DailyLog log, IReadOnlyList<CostEntryDto> movedMoney, Guid actor, DateTime now, CancellationToken ct)
    {
        var scope = await FarmReadGate.ScopeAsync(repository, (Guid)log.FarmId, actor, now, ct);
        // lane PRV fix pass 2 (D-69) — money kept from him never rides his answer, and its record comes back as for a seat
        // without see money.
        var visibility = await RecordVisibility.ForFarmAsync(repository, (Guid)log.FarmId, actor, now, ct);
        var dto = log.ToDto();
        return new MoveDailyLogResultDto(
            ReadScopeProjection.Record(dto, RecordMoneyAccess.ScopeFor(dto, scope, visibility), actor),
            ReadScopeProjection.Money(movedMoney.Where(m => visibility.MaySeeCost(m.Id)).ToList(), scope));
    }

    /// <summary>The crop season on <paramref name="plotId"/> (this farm only) that covers <paramref name="day"/>, or null.</summary>
    private async Task<Guid?> CycleCoveringAsync(DailyLog log, Guid plotId, DateOnly day, CancellationToken ct)
    {
        var cycles = await repository.GetCropCyclesByPlotIdAsync(plotId, ct);
        return cycles
            .Where(c => c.FarmId == log.FarmId && c.PlotId == plotId
                        && c.StartDate <= day && (c.EndDate is null || c.EndDate >= day))
            .OrderByDescending(c => c.StartDate)
            .Select(c => (Guid?)c.Id)
            .FirstOrDefault();
    }

    private static object Placement(DailyLog log) => new
    {
        scope = log.Scope.ToString(),
        plotIds = log.PlotIds.ToArray(),
        cropCycleId = log.CropCycleId,
        logDate = log.LogDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
    };

    /// <summary>
    /// The day aggregate (DFES) of one day, rebuilt after the move — the create path's non-blocking side-car, in a
    /// SAVEPOINT on the ambient (sync) transaction so a failure rolls back only itself. Never silent: every failure
    /// is a warning naming the farm and day (the aggregate is then stale until the next save on that day).
    /// </summary>
    private async Task RecomputeDayAsync(Guid farmId, DateOnly day, CancellationToken ct)
    {
        if (dailyRichnessDerivation is null)
        {
            return;
        }

        var ambientTx = dbContext?.Database.IsRelational() == true ? dbContext.Database.CurrentTransaction : null;
        const string savepoint = "ssf_move_daily_log_richness";
        try
        {
            if (ambientTx is not null)
            {
                await ambientTx.CreateSavepointAsync(savepoint, ct);
            }

            await dailyRichnessDerivation.RecomputeAsync(farmId, day, ct);
            await repository.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex,
                "move_daily_log: the day aggregate for farm {FarmId} on {Day} was not rebuilt (non-blocking).", farmId, day);
            if (ambientTx is not null)
            {
                await ambientTx.RollbackToSavepointAsync(savepoint, ct);
            }

            dbContext?.ChangeTracker.Clear();
        }
    }
}
