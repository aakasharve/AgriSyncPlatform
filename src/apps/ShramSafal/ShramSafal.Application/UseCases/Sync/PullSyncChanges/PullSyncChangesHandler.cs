using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Application.UseCases.Compliance.GetComplianceSignalsForFarm;
using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

public sealed class PullSyncChangesHandler(
    IShramSafalRepository repository,
    IClock clock,
    GetScheduleTemplatesHandler getScheduleTemplatesHandler,
    GetAttentionBoardHandler getAttentionBoardHandler,
    ITestInstanceRepository testInstanceRepository,
    ITestProtocolRepository testProtocolRepository,
    ITestRecommendationRepository testRecommendationRepository,
    IComplianceSignalRepository complianceSignalRepository,
    GetComplianceSignalsForFarmHandler getComplianceSignalsHandler,
    EvaluateComplianceHandler evaluateComplianceHandler,
    ILogger<PullSyncChangesHandler> logger)
{
    // Sub-plan 03 Task 10 — stable component identifiers used in
    // DegradedComponent.ComponentName. Frontend keys on these.
    private const string ComponentAttentionBoard = "AttentionBoard";
    private const string ComponentJobCards = "JobCards";
    private const string ComponentComplianceFreshness = "ComplianceFreshness";
    private const string ComponentComplianceSignals = "ComplianceSignals";
    public async Task<Result<SyncPullResponseDto>> HandleAsync(PullSyncChangesQuery query, CancellationToken ct = default)
    {
        var serverNowUtc = clock.UtcNow;
        var sinceUtc = NormalizeCursor(query.SinceUtc, serverNowUtc);
        var farmIds = await repository.GetFarmIdsForUserAsync(query.UserId, ct);
        var farmIdSet = farmIds.ToHashSet();

        var farms = (await repository.GetFarmsChangedSinceAsync(sinceUtc, ct))
            .Where(f => farmIdSet.Contains((Guid)f.Id))
            .ToList();
        var plots = (await repository.GetPlotsChangedSinceAsync(sinceUtc, ct))
            .Where(p => farmIdSet.Contains((Guid)p.FarmId))
            .ToList();
        var cropCycles = (await repository.GetCropCyclesChangedSinceAsync(sinceUtc, ct))
            .Where(c => farmIdSet.Contains((Guid)c.FarmId))
            .ToList();
        var dailyLogs = (await repository.GetDailyLogsChangedSinceAsync(sinceUtc, ct))
            .Where(l => farmIdSet.Contains((Guid)l.FarmId))
            .ToList();
        var attachments = (await repository.GetAttachmentsChangedSinceAsync(sinceUtc, ct))
            .Where(a => farmIdSet.Contains((Guid)a.FarmId))
            .ToList();
        var costEntries = (await repository.GetCostEntriesChangedSinceAsync(sinceUtc, ct))
            .Where(c => farmIdSet.Contains((Guid)c.FarmId))
            .ToList();
        var costEntryIds = costEntries.Select(c => c.Id).ToHashSet();
        var financeCorrections = (await repository.GetFinanceCorrectionsChangedSinceAsync(sinceUtc, ct))
            .Where(c => costEntryIds.Contains(c.CostEntryId))
            .ToList();
        var dayLedgers = (await repository.GetDayLedgersChangedSinceAsync(sinceUtc, ct))
            .Where(l => farmIdSet.Contains((Guid)l.FarmId))
            .ToList();
        var priceConfigs = (await repository.GetPriceConfigsChangedSinceAsync(sinceUtc, ct))
            .Where(p => (Guid)p.CreatedByUserId == query.UserId)
            .ToList();
        var cropCycleIds = cropCycles.Select(c => c.Id).ToHashSet();
        var plannedActivities = (await repository.GetPlannedActivitiesChangedSinceAsync(sinceUtc, ct))
            .Where(a => cropCycleIds.Contains(a.CropCycleId))
            .ToList();
        var auditEvents = (await repository.GetAuditEventsChangedSinceAsync(sinceUtc, ct))
            .Where(a => !a.FarmId.HasValue || farmIdSet.Contains(a.FarmId.Value))
            .ToList();
        var templatesResult = await getScheduleTemplatesHandler.HandleAsync(ct);
        if (!templatesResult.IsSuccess)
        {
            return Result.Failure<SyncPullResponseDto>(templatesResult.Error);
        }

        var scheduleTemplates = templatesResult.Value ?? [];
        var cropTypes = GetScheduleTemplatesHandler.BuildCropTypes(scheduleTemplates);
        var referenceDataVersionHash = scheduleTemplates.Count > 0
            ? scheduleTemplates[0].VersionHash
            : ReferenceDataCatalog.VersionHash;
        var operatorIds = CollectOperatorIds(
            query.UserId,
            farms,
            dailyLogs,
            attachments,
            costEntries,
            financeCorrections,
            dayLedgers,
            auditEvents);
        var operators = await repository.GetOperatorsByIdsAsync(operatorIds, ct);

        var nextCursorUtc = ComputeNextCursor(
            sinceUtc,
            farms,
            plots,
            cropCycles,
            dailyLogs,
            attachments,
            costEntries,
            financeCorrections,
            dayLedgers,
            priceConfigs,
            plannedActivities,
            auditEvents);

        // Sub-plan 03 Task 10 — collect partial-failure components.
        // When this list is non-empty, the response carries
        // DegradedComponents + the X-Degraded HTTP header so clients
        // can show a partial-data badge, AND the cursor-freeze block
        // below resets NextCursorUtc to SinceUtc so the next pull
        // retries the same window (no silent data loss).
        var degraded = new List<DegradedComponent>();

        // AttentionBoard is computed as a snapshot on every pull.
        // If the inner handler returns Result.Failure (e.g. "no attention
        // items"), pass null verbatim — that's a normal "nothing to show"
        // outcome, not a degraded one. We only DEGRADE on a thrown
        // exception (infrastructure failure: query timeout, transient DB
        // error, NRE in computation); a Result.Failure is a typed
        // outcome and stays silent.
        AttentionBoardDto? attentionBoard = null;
        try
        {
            var attentionResult = await getAttentionBoardHandler.HandleAsync(
                new GetAttentionBoardQuery(query.UserId, serverNowUtc), ct);
            attentionBoard = attentionResult.IsSuccess ? attentionResult.Value : null;
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "PullSync: AttentionBoard threw {ExceptionType}; degrading.",
                ex.GetType().Name);
            degraded.Add(new DegradedComponent(
                ComponentAttentionBoard,
                "AttentionBoard.Unavailable",
                ex.Message));
        }

        // CEI Phase 2 §4.5 — test instances modified since the cursor, scoped
        // to the caller's farms. Recommendations follow the parent instances.
        var typedFarmIds = farmIds.Select(id => new FarmId(id)).ToList();
        var testInstances = typedFarmIds.Count == 0
            ? Array.Empty<Domain.Tests.TestInstance>()
            : (IReadOnlyList<Domain.Tests.TestInstance>)await testInstanceRepository
                .GetModifiedSinceAsync(typedFarmIds, sinceUtc, ct);
        var testInstanceIds = testInstances.Select(i => i.Id).ToList();
        var testRecommendations = testInstanceIds.Count == 0
            ? Array.Empty<Domain.Tests.TestRecommendation>()
            : (IReadOnlyList<Domain.Tests.TestRecommendation>)await testRecommendationRepository
                .GetByTestInstanceIdsAsync(testInstanceIds, ct);
        // Resolve protocol names for each distinct protocol ID in one pass —
        // the in-memory stub and the future EF repo both support a single
        // by-id lookup cheaply.
        var protocolIds = testInstances.Select(i => i.TestProtocolId).Distinct().ToList();
        var protocolNames = new Dictionary<Guid, string?>();
        foreach (var protocolId in protocolIds)
        {
            var protocol = await testProtocolRepository.GetByIdAsync(protocolId, ct);
            protocolNames[protocolId] = protocol?.Name;
        }

        var testInstanceDtos = testInstances
            .Select(i => TestInstanceDto.FromDomain(
                i,
                protocolNames.TryGetValue(i.TestProtocolId, out var name) ? name : null))
            .ToList();
        var testRecommendationDtos = testRecommendations
            .Select(TestRecommendationDto.FromDomain)
            .ToList();

        // Advance the cursor past the test-instance / recommendation stream as
        // well so the next pull starts after the newest row emitted here.
        if (testInstances.Count > 0)
        {
            var maxTestInstance = testInstances.Max(i => i.ModifiedAtUtc);
            if (maxTestInstance > nextCursorUtc)
            {
                nextCursorUtc = maxTestInstance;
            }
        }
        if (testRecommendations.Count > 0)
        {
            var maxRec = testRecommendations.Max(r => r.CreatedAtUtc);
            if (maxRec > nextCursorUtc)
            {
                nextCursorUtc = maxRec;
            }
        }

        // CEI Phase 4 §4.8 — job cards modified since cursor, scoped to
        // caller's farms. On failure: keep the empty list and record a
        // DegradedComponent. The cursor-freeze block below picks this
        // up and rewinds NextCursorUtc so the missed JobCards rows
        // reach the client on the next pull.
        List<JobCardDto> jobCardDtos = [];
        try
        {
            var changedJobCards = await repository.GetJobCardsChangedSinceAsync(farmIds, sinceUtc, ct);
            jobCardDtos = changedJobCards.Select(j => j.ToJobCardDto()).ToList();
            if (jobCardDtos.Count > 0)
            {
                var maxJobCard = changedJobCards.Max(j => j.ModifiedAtUtc);
                if (maxJobCard > nextCursorUtc) nextCursorUtc = maxJobCard;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "PullSync: JobCards fetch threw {ExceptionType}; degrading.",
                ex.GetType().Name);
            degraded.Add(new DegradedComponent(
                ComponentJobCards,
                "JobCards.Unavailable",
                ex.Message));
        }

        // CEI Phase 3 §4.6 — compliance signals since cursor (per farm), with
        // on-pull freshness trigger: if latest evaluation is >6h old, fire async eval.
        var complianceSignalDtos = new List<ComplianceSignalDto>();
        foreach (var fid in farmIds)
        {
            var typedFarmId = new FarmId(fid);

            // Freshness check — fire-and-forget if stale (>6 hours).
            // Sub-plan 03 Task 10: capture exceptions instead of swallowing.
            // The freshness READ (line A) and the BACKGROUND eval (line B)
            // are separate concerns and degrade independently.
            try
            {
                var latestEval = await complianceSignalRepository.GetLatestEvaluationTimeAsync(typedFarmId, ct);
                if (latestEval is null || (serverNowUtc - latestEval.Value).TotalHours > 6)
                {
                    // Fire-and-forget: do not await; the inner try/catch
                    // logs into our captured logger so the failure is
                    // observable even though the outer pull doesn't
                    // wait for it.
                    var capturedLogger = logger;
                    var capturedFarmId = typedFarmId;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await evaluateComplianceHandler.HandleAsync(
                                new EvaluateComplianceCommand(capturedFarmId),
                                CancellationToken.None);
                        }
                        catch (Exception ex)
                        {
                            capturedLogger.LogWarning(ex,
                                "PullSync: background ComplianceEvaluation for farm {FarmId} threw {ExceptionType}.",
                                capturedFarmId, ex.GetType().Name);
                        }
                    }, CancellationToken.None);
                }
            }
            catch (Exception ex)
            {
                // Freshness read failed — surface as degraded so the
                // frontend knows the freshness lamp may be stale.
                logger.LogWarning(ex,
                    "PullSync: ComplianceFreshness read for farm {FarmId} threw {ExceptionType}; degrading.",
                    typedFarmId, ex.GetType().Name);
                degraded.Add(new DegradedComponent(
                    ComponentComplianceFreshness,
                    "ComplianceFreshness.Unavailable",
                    ex.Message));
            }

            // Pull signals since cursor
            try
            {
                var signals = await complianceSignalRepository.GetSinceCursorAsync(typedFarmId, sinceUtc, ct);
                complianceSignalDtos.AddRange(
                    signals.Select(GetComplianceSignalsForFarmHandler.MapToDto));
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "PullSync: ComplianceSignals fetch for farm {FarmId} threw {ExceptionType}; degrading.",
                    typedFarmId, ex.GetType().Name);
                degraded.Add(new DegradedComponent(
                    ComponentComplianceSignals,
                    "ComplianceSignals.Unavailable",
                    ex.Message));
            }
        }

        // Advance cursor past compliance signals
        if (complianceSignalDtos.Count > 0)
        {
            var maxSignal = complianceSignalDtos.Max(s => s.LastSeenAtUtc);
            if (maxSignal > nextCursorUtc) nextCursorUtc = maxSignal;
        }

        // Sub-plan 03 Task 10 (T-IGH-03-PULL-CURSOR-FREEZE) — cursor
        // freeze on partial failure. If ANY component degraded,
        // NextCursorUtc is set BACK to SinceUtc so the next pull
        // retries the same window. Without this, a partial failure
        // could silently advance the cursor past data the client
        // never received (cost: small redundant work on the next pull;
        // benefit: no silent data loss).
        if (degraded.Count > 0)
        {
            logger.LogWarning(
                "PullSync: {Count} component(s) degraded ({Components}); freezing NextCursorUtc at {SinceUtc} for retry.",
                degraded.Count, string.Join(",", degraded.Select(d => d.ComponentName)), sinceUtc);
            nextCursorUtc = sinceUtc;
        }

        var response = new SyncPullResponseDto(
            serverNowUtc,
            nextCursorUtc,
            farms.Select(f => f.ToDto()).ToList(),
            plots.Select(p => p.ToDto()).ToList(),
            cropCycles.Select(c => c.ToDto()).ToList(),
            dailyLogs.Select(l => l.ToDto()).ToList(),
            attachments.Select(a => a.ToDto()).ToList(),
            costEntries.Select(c => c.ToDto()).ToList(),
            financeCorrections.Select(c => c.ToDto()).ToList(),
            dayLedgers.Select(l => l.ToDto()).ToList(),
            priceConfigs.Select(c => c.ToDto()).ToList(),
            plannedActivities.Select(a => a.ToDto()).ToList(),
            auditEvents.Select(a => a.ToDto()).ToList(),
            operators.ToList(),
            scheduleTemplates,
            cropTypes,
            ReferenceDataCatalog.ActivityCategories,
            ReferenceDataCatalog.CostCategories,
            referenceDataVersionHash,
            attentionBoard,
            testInstanceDtos,
            testRecommendationDtos,
            complianceSignalDtos,
            jobCardDtos,
            // Sub-plan 03 Task 10: empty list when healthy; non-empty
            // signals partial data AND triggers the NextCursorUtc
            // rewind handled in the if-block above.
            degraded);

        return Result.Success(response);
    }

    private static DateTime NormalizeCursor(DateTime rawCursor, DateTime serverNowUtc)
    {
        var cursor = rawCursor.Kind switch
        {
            DateTimeKind.Utc => rawCursor,
            DateTimeKind.Local => rawCursor.ToUniversalTime(),
            _ => DateTime.SpecifyKind(rawCursor, DateTimeKind.Utc)
        };

        if (cursor < DateTime.UnixEpoch)
        {
            return DateTime.UnixEpoch;
        }

        if (cursor > serverNowUtc)
        {
            return serverNowUtc;
        }

        return cursor;
    }

    private static DateTime ComputeNextCursor(
        DateTime sinceUtc,
        IReadOnlyList<Domain.Farms.Farm> farms,
        IReadOnlyList<Domain.Farms.Plot> plots,
        IReadOnlyList<Domain.Crops.CropCycle> cropCycles,
        IReadOnlyList<Domain.Logs.DailyLog> dailyLogs,
        IReadOnlyList<Domain.Attachments.Attachment> attachments,
        IReadOnlyList<Domain.Finance.CostEntry> costEntries,
        IReadOnlyList<Domain.Finance.FinanceCorrection> financeCorrections,
        IReadOnlyList<Domain.Finance.DayLedger> dayLedgers,
        IReadOnlyList<Domain.Finance.PriceConfig> priceConfigs,
        IReadOnlyList<Domain.Planning.PlannedActivity> plannedActivities,
        IReadOnlyList<Domain.Audit.AuditEvent> auditEvents)
    {
        var maxTimestamp = sinceUtc;

        if (farms.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, farms.Max(f => f.ModifiedAtUtc));
        }

        if (plots.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plots.Max(p => p.ModifiedAtUtc));
        }

        if (cropCycles.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, cropCycles.Max(c => c.ModifiedAtUtc));
        }

        if (dailyLogs.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dailyLogs.Max(log => log.ModifiedAtUtc));
        }

        if (attachments.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, attachments.Max(a => a.ModifiedAtUtc));
        }

        if (costEntries.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, costEntries.Max(c => c.ModifiedAtUtc));
        }

        if (financeCorrections.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, financeCorrections.Max(c => c.ModifiedAtUtc));
        }

        if (dayLedgers.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dayLedgers.Max(c => c.ModifiedAtUtc));
        }

        if (priceConfigs.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, priceConfigs.Max(c => c.ModifiedAtUtc));
        }

        if (dayLedgers.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dayLedgers.Max(c => c.CreatedAtUtc));
        }

        if (plannedActivities.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plannedActivities.Max(a => a.ModifiedAtUtc));
        }

        if (auditEvents.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, auditEvents.Max(a => a.OccurredAtUtc));
        }

        return maxTimestamp;
    }

    private static DateTime Max(DateTime left, DateTime right) => left >= right ? left : right;

    private static HashSet<Guid> CollectOperatorIds(
        Guid requestingUserId,
        IReadOnlyList<Domain.Farms.Farm> farms,
        IReadOnlyList<Domain.Logs.DailyLog> dailyLogs,
        IReadOnlyList<Domain.Attachments.Attachment> attachments,
        IReadOnlyList<Domain.Finance.CostEntry> costEntries,
        IReadOnlyList<Domain.Finance.FinanceCorrection> financeCorrections,
        IReadOnlyList<Domain.Finance.DayLedger> dayLedgers,
        IReadOnlyList<Domain.Audit.AuditEvent> auditEvents)
    {
        var ids = new HashSet<Guid>();
        AddIfValid(requestingUserId, ids);

        foreach (var farm in farms)
        {
            AddIfValid((Guid)farm.OwnerUserId, ids);
        }

        foreach (var log in dailyLogs)
        {
            AddIfValid((Guid)log.OperatorUserId, ids);
            foreach (var verification in log.VerificationEvents)
            {
                AddIfValid((Guid)verification.VerifiedByUserId, ids);
            }
        }

        foreach (var attachment in attachments)
        {
            AddIfValid((Guid)attachment.CreatedByUserId, ids);
        }

        foreach (var entry in costEntries)
        {
            AddIfValid((Guid)entry.CreatedByUserId, ids);
        }

        foreach (var correction in financeCorrections)
        {
            AddIfValid((Guid)correction.CorrectedByUserId, ids);
        }

        foreach (var ledger in dayLedgers)
        {
            AddIfValid((Guid)ledger.CreatedByUserId, ids);
        }

        foreach (var auditEvent in auditEvents)
        {
            AddIfValid((Guid)auditEvent.ActorUserId, ids);
        }

        return ids;
    }

    private static void AddIfValid(Guid value, HashSet<Guid> ids)
    {
        if (value != Guid.Empty)
        {
            ids.Add(value);
        }
    }
}
