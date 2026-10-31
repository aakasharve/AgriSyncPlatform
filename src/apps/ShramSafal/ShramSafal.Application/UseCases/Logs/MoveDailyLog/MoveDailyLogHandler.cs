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
/// <item><b>When</b> — never a day after the farm's today (<see cref="LogDayRule"/>).</item>
/// <item><b>Never over a newer change</b> — the row is held for this change (<c>GetDailyLogForChangeAsync</c>) and a
/// move made from an older version is refused (<see cref="ShramSafalErrors.LogMoveStale"/>).</item>
/// <item><b>What moves with it</b> — the record keeps its id, so everything hanging off it by <c>daily_log_id</c>
/// (task lines, content versions, labour engagements and their stated money, verification history) moves without
/// being touched. The one COPY of the day on a part of it — a named person's work row
/// (<see cref="FieldOperatorWorkRow.WorkDate"/>) — follows the record to the new day.</item>
/// <item><b>What refuses a move</b> (CTO call, lane OF-S) — a हजेरी ruling on the OLD day for a person named on this
/// record's labour (a day move would leave the ruling without its record), and any live job card linked to the record
/// (it carries its own plot and its payout is evidenced by this record's day). Refused whole: nothing changes
/// (<see cref="ShramSafalErrors.LogMoveLinkedRecords"/>). A place-only move is not stopped by हजेरी: a ruling is about
/// a person on a DAY and names no plot.</item>
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
    : IHandler<MoveDailyLogCommand, DailyLogDto>
{
    /// <summary>The audit action of the one ledger row a move writes.</summary>
    public const string MovedAction = "LogMoved";

    public async Task<Result<DailyLogDto>> HandleAsync(MoveDailyLogCommand command, CancellationToken ct = default)
    {
        // ── 1. Shape. Nothing is read yet. ─────────────────────────────────────────────────────
        var newPlotIds = command.NewPlotIds?.ToArray();
        if (command.DailyLogId == Guid.Empty || command.ActorUserId == Guid.Empty || command.BaseVersion < 1
            || (newPlotIds is not null && (newPlotIds.Length == 0 || command.WholeFarm
                || newPlotIds.Any(id => id == Guid.Empty) || newPlotIds.Distinct().Count() != newPlotIds.Length))
            || (newPlotIds is null && !command.WholeFarm && command.NewLogDate is null)
            || command.Reason is { Length: > 400 })
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }

        // ── 2. The record, held for this change (a second change waits and then sees this one). ───
        var log = await repository.GetDailyLogForChangeAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var now = clock.UtcNow;
        if (await LogEditGate.CheckAsync(repository, entitlementPolicy, log, command.ActorUserId, now, ct) is { } refusal)
        {
            logger.LogWarning("move_daily_log for {LogId} refused: {Code}.", log.Id, refusal.Code);
            return Result.Failure<DailyLogDto>(refusal);
        }

        // ── 3. When. ───────────────────────────────────────────────────────────────────────────
        var targetDate = command.NewLogDate ?? log.LogDate;
        if (command.NewLogDate is { } chosenDay && LogDayRule.IsInFuture(chosenDay, now))
        {
            logger.LogWarning("move_daily_log for {LogId} refused: {Day} is after the farm's today.", log.Id, chosenDay);
            return Result.Failure<DailyLogDto>(ShramSafalErrors.LogDateInFuture);
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
                    return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
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
                return Result.Failure<DailyLogDto>(ShramSafalErrors.LogMoveNoCropCycle);
            }
        }

        // Already there: nothing to move, nothing written, no version, no re-open.
        if (log.IsPlacedAt(scope, targetPlots, cropCycleId, targetDate))
        {
            return Result.Success(log.ToDto());
        }

        // ── 5. Never over a newer change. ───────────────────────────────────────────────────────
        if (command.BaseVersion < log.ContentVersion)
        {
            logger.LogInformation(
                "move_daily_log for {LogId} refused as stale: made from version {Base}, the record is at {Current}.",
                log.Id, command.BaseVersion, log.ContentVersion);
            return Result.Failure<DailyLogDto>(ShramSafalErrors.LogMoveStale);
        }

        // ── 6. What is tied to it and cannot follow. Still nothing staged. ────────────────────
        var jobCard = await repository.GetJobCardByLinkedDailyLogIdAsync(log.Id, ct);
        if (jobCard is not null && jobCard.Status != JobCardStatus.Cancelled)
        {
            logger.LogWarning("move_daily_log for {LogId} refused: job card {JobCardId} ({Status}) is linked to it.",
                log.Id, jobCard.Id, jobCard.Status);
            return Result.Failure<DailyLogDto>(ShramSafalErrors.LogMoveLinkedRecords);
        }

        var dayChanges = targetDate != log.LogDate;
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
                    return Result.Failure<DailyLogDto>(ShramSafalErrors.LogMoveLinkedRecords);
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

        if (dayChanges)
        {
            await RecomputeDayAsync((Guid)log.FarmId, fromDay, ct);
            await RecomputeDayAsync((Guid)log.FarmId, targetDate, ct);
        }

        return Result.Success(log.ToDto());
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
