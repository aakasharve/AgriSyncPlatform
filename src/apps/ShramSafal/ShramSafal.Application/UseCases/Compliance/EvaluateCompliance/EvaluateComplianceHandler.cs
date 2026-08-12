using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;

/// <summary>
/// CEI Phase 3 §4.6 — idempotent compliance evaluation for a single farm.
///
/// For each rule × evidence tuple the evaluator produces:
///   • If there is already an open signal for the key → Refresh.
///   • Otherwise → Open a new signal.
///
/// Open signals whose key is NOT in the fresh result set → auto-resolved.
///
/// The <see cref="ComplianceRuleCode.ProtocolBreakInStage"/> rule is handler-coupled:
/// the domain evaluator returns empty evidence; this handler runs CompareEngine per
/// plot and keeps a consecutive-critical-day counter in the signal's PayloadJson.
/// </summary>
public sealed class EvaluateComplianceHandler(
    IShramSafalRepository repository,
    IComplianceSignalRepository signalRepository,
    ITestInstanceRepository testInstanceRepository,
    IClock clock,
    ILogger<EvaluateComplianceHandler> logger) : IHandler<EvaluateComplianceCommand, EvaluateComplianceResult>
{
    private sealed record SignalKey(FarmId FarmId, Guid PlotId, string RuleCode, Guid? CropCycleId);

    private sealed record ProtocolBreakPayload(int ConsecutiveCriticalDays);

    public async Task<Result<EvaluateComplianceResult>> HandleAsync(
        EvaluateComplianceCommand command,
        CancellationToken ct = default)
    {
        if (command is null || command.FarmId.IsEmpty)
            return Result.Failure<EvaluateComplianceResult>(new AgriSync.BuildingBlocks.Results.Error("Compliance.InvalidCommand", "FarmId is required."));

        var farmId = command.FarmId;
        var now = clock.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var weekAgo = today.AddDays(-7);

        // --- Build evaluation input ---
        var plots = await repository.GetPlotsByFarmIdAsync((Guid)farmId, ct);
        var dailyLogs = await repository.GetDailyLogsByFarmAsync(farmId, ct);
        var plannedActivitiesLastWeek = await repository.GetPlannedActivitiesForFarmSinceAsync(farmId, weekAgo, ct);
        var logTasksLastWeek = await repository.GetLogTasksForFarmSinceAsync(farmId, weekAgo, ct);

        var testInstances = await testInstanceRepository.GetByFarmIdAndStatusAsync(
            farmId,
            [TestInstanceStatus.Due, TestInstanceStatus.Overdue, TestInstanceStatus.Reported],
            ct);

        var input = new ComplianceEvaluationInput(
            FarmId: farmId,
            AsOfUtc: now,
            PlannedActivitiesLastWeek: plannedActivitiesLastWeek,
            LogTasksLastWeek: logTasksLastWeek,
            DailyLogs: dailyLogs,
            TestInstances: testInstances,
            Plots: plots);

        // LABOUR_PHASE2 P2.3 — say out loud what this pass cannot represent.
        //
        // ssf.compliance_signals.plot_id is NOT NULL and is part of
        // ix_compliance_signals_open_unique, so a disputed log whose scope is
        // MultiPlot or Farm (plot_id IS NULL by design — the farmer named no
        // single plot) cannot get an UnresolvedDisputeAgeHigh signal at this
        // schema. The rule book therefore skips it. A skip nobody can see is
        // indistinguishable from a bug, so the skip is counted and reported
        // here rather than being an accidental silence. Inventing a plot, or
        // fanning one dispute across every plot, are the two fabrications
        // founder decision O-1 closed; neither is on the table.
        var unrepresentableDisputes =
            ComplianceRuleBook.UnresolvedDisputesWithNoRepresentableSignal(input);
        if (unrepresentableDisputes.Count > 0)
        {
            logger.LogWarning(
                "EvaluateCompliance: farm {FarmId} has {UnrepresentableDisputeCount} unresolved disputed log(s) with no plot (scope MultiPlot or Farm). No UnresolvedDisputeAgeHigh signal can be opened for them because ssf.compliance_signals.plot_id is NOT NULL and part of the open-signal unique index. They are not ignored — they are unrepresentable at this schema. Daily log ids: {UnrepresentableDisputeLogIds}.",
                farmId,
                unrepresentableDisputes.Count,
                string.Join(",", unrepresentableDisputes.Select(d => d.Id)));
        }

        // --- Run pure domain evaluator (all rules except ProtocolBreakInStage) ---
        var freshResults = ComplianceEvaluator.Evaluate(input);

        // --- Get currently-open signals for the farm ---
        //
        // `ix_compliance_signals_open_unique` (partial UNIQUE on
        // farm_id, plot_id, rule_code, crop_cycle_id WHERE resolved_at_utc IS NULL
        // AND acknowledged_at_utc IS NULL) is the correctness guard behind this map:
        // at most ONE open signal may exist per key. Postgres unique indexes treat
        // NULLs as DISTINCT, though, so rows whose crop_cycle_id is NULL (e.g.
        // RepeatedSkipsPerActivity, which reports at farm level with PlotId
        // Guid.Empty / CropCycleId null) are NOT covered by it. Build the map
        // defensively so a pre-existing NULL-cycle duplicate degrades into "refresh
        // the first one and warn" rather than an ArgumentException that aborts the
        // whole farm's evaluation. The within-pass collapse below is what stops new
        // duplicates being written in the first place.
        var openSignals = await signalRepository.GetOpenForFarmAsync(farmId, ct);
        var openByKey = new Dictionary<SignalKey, ComplianceSignal>();
        foreach (var openSignal in openSignals)
        {
            var openKey = new SignalKey(
                openSignal.FarmId, openSignal.PlotId, openSignal.RuleCode, openSignal.CropCycleId);

            if (!openByKey.TryAdd(openKey, openSignal))
            {
                logger.LogWarning(
                    "EvaluateCompliance: farm {FarmId} already has an open signal for rule {RuleCode} on plot {PlotId} (crop cycle {CropCycleId}); signal {SignalId} is a duplicate and will be left untouched by this pass.",
                    farmId, openSignal.RuleCode, openSignal.PlotId, openSignal.CropCycleId, openSignal.Id);
            }
        }

        int opened = 0, refreshed = 0, autoResolved = 0;

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — capture forensic provenance
        // from the command once; the EmitAudit helper inherits it for every
        // signal row written below. HTTP callers pass real X-Device-Id / IP
        // hash via ComplianceEndpoints; cron callers (ComplianceEvaluatorSweeper)
        // pass the worker sentinel pair from AuditContextAccessor.WorkerClaims().
        var auditProvenance = new AuditProvenance(
            command.ClientAppVersion,
            command.AuditDeviceId,
            command.AuditIpHash);

        // Track keys that the fresh evaluation produced
        var freshKeys = new HashSet<SignalKey>();

        // --- Process standard rule results ---
        foreach (var (rule, evidence) in freshResults)
        {
            // Skip ProtocolBreakInStage — handled separately below
            if (rule.RuleCode == ComplianceRuleCode.ProtocolBreakInStage)
                continue;

            var key = new SignalKey(evidence.FarmId, evidence.PlotId, rule.RuleCode, evidence.CropCycleId);

            // One rule can legitimately yield SEVERAL evidence rows that collapse onto
            // ONE signal key. UnresolvedDisputeAgeHigh emits one evidence per disputed
            // daily log, so two logs disputed on the same plot + crop cycle produce the
            // identical (farm, plot, rule, cycle) tuple; SkippedTestOverdue and
            // ResidueRiskReported do the same for multiple test instances on one plot.
            // `ix_compliance_signals_open_unique` permits exactly one OPEN row per key,
            // so the FIRST evidence for a key materialises (or refreshes) the signal and
            // every later evidence for that same key folds into it. Without this the
            // handler queued two INSERTs for one key in a single SaveChanges and
            // Postgres rejected the batch with 23505.
            //
            // HashSet.Add returns false when the key is already present, which is
            // exactly the "already handled during this pass" test; freshKeys is
            // populated here and consumed by the auto-resolve loop below, so a folded
            // duplicate still counts as "seen this pass" and cannot be auto-resolved.
            if (!freshKeys.Add(key))
            {
                continue;
            }

            if (openByKey.TryGetValue(key, out var existing))
            {
                existing.Refresh(now);
                refreshed++;
                EmitAudit(repository, existing, "compliance.refreshed", now, auditProvenance);
            }
            else
            {
                var signal = ComplianceSignal.Open(
                    id: Guid.NewGuid(),
                    farmId: evidence.FarmId,
                    plotId: evidence.PlotId,
                    cropCycleId: evidence.CropCycleId,
                    ruleCode: rule.RuleCode,
                    severity: rule.Severity,
                    suggestedAction: rule.SuggestedAction,
                    titleEn: rule.TitleEn,
                    titleMr: rule.TitleMr,
                    descriptionEn: evidence.DescriptionEn,
                    descriptionMr: evidence.DescriptionMr,
                    payloadJson: evidence.PayloadJson,
                    firstSeenAtUtc: now);

                signalRepository.Add(signal);
                // Keep the "at most one OPEN signal per key" invariant — the same
                // invariant ix_compliance_signals_open_unique enforces in the database
                // — true for the remainder of this pass, so nothing downstream can
                // queue a second INSERT for a key we have just materialised.
                openByKey[key] = signal;
                opened++;
                EmitAudit(repository, signal, "compliance.opened", now, auditProvenance);
            }
        }

        // --- ProtocolBreakInStage: handler-coupled, per-plot using CompareEngine ---
        var protocolBreakRule = ComplianceRuleBook.Rules
            .First(r => r.RuleCode == ComplianceRuleCode.ProtocolBreakInStage);

        foreach (var plot in plots)
        {
            var cycles = await repository.GetCropCyclesByPlotIdAsync(plot.Id, ct);
            var latestCycle = cycles.OrderByDescending(c => c.StartDate).FirstOrDefault();
            if (latestCycle is null) continue;

            var stageName = latestCycle.Stage ?? "Unknown";
            var planned = await repository.GetPlannedActivitiesByCropCycleIdAsync(latestCycle.Id, ct);
            var executed = await repository.GetExecutedTasksByCropCycleIdAsync(latestCycle.Id, ct);
            planned = planned.Where(p => !p.IsRemoved).ToList();

            HealthScore? health = null;
            if (planned.Count > 0)
            {
                var compareResult = CompareEngine.ComputeStageComparison(planned, executed, stageName);
                health = compareResult.OverallHealth;
            }

            var pbKey = new SignalKey(farmId, plot.Id, ComplianceRuleCode.ProtocolBreakInStage, latestCycle.Id);

            if (health == HealthScore.Critical)
            {
                // Increment consecutive day counter
                int prevCount = 0;
                if (openByKey.TryGetValue(pbKey, out var prevSignal))
                {
                    // Sub-plan 03 Task 10: be specific about what we're
                    // tolerating — a stored payload with the wrong shape
                    // (legacy data, manual edit) shouldn't fail the whole
                    // evaluation. Anything else (e.g. NRE) is a real bug
                    // and must propagate.
                    try
                    {
                        var prev = JsonSerializer.Deserialize<ProtocolBreakPayload>(prevSignal.PayloadJson);
                        prevCount = prev?.ConsecutiveCriticalDays ?? 0;
                    }
                    catch (JsonException ex)
                    {
                        logger.LogWarning(ex,
                            "EvaluateCompliance: malformed PayloadJson on existing ProtocolBreak signal for farm {FarmId} plot {PlotId}; defaulting consecutive-critical-days to 0.",
                            farmId, plot.Id);
                        prevCount = 0;
                    }
                }

                var newCount = prevCount + 1;
                var newPayload = JsonSerializer.Serialize(new { consecutiveCriticalDays = newCount });

                if (newCount >= 3)
                {
                    freshKeys.Add(pbKey);

                    if (openByKey.TryGetValue(pbKey, out var existing))
                    {
                        existing.Refresh(now);
                        existing.UpdatePayload(newPayload);
                        refreshed++;
                        EmitAudit(repository, existing, "compliance.refreshed", now, auditProvenance);
                    }
                    else
                    {
                        var signal = ComplianceSignal.Open(
                            id: Guid.NewGuid(),
                            farmId: farmId,
                            plotId: plot.Id,
                            cropCycleId: latestCycle.Id,
                            ruleCode: ComplianceRuleCode.ProtocolBreakInStage,
                            severity: protocolBreakRule.Severity,
                            suggestedAction: protocolBreakRule.SuggestedAction,
                            titleEn: protocolBreakRule.TitleEn,
                            titleMr: protocolBreakRule.TitleMr,
                            descriptionEn: $"Stage '{stageName}' health has been Critical for {newCount} consecutive days.",
                            descriptionMr: $"'{stageName}' टप्प्याची आरोग्य स्थिती {newCount} दिवसांपासून गंभीर आहे.",
                            payloadJson: newPayload,
                            firstSeenAtUtc: now);

                        signalRepository.Add(signal);
                        opened++;
                        EmitAudit(repository, signal, "compliance.opened", now, auditProvenance);
                    }
                }
                else if (openByKey.TryGetValue(pbKey, out var trackingSignal))
                {
                    // Update the counter even when < 3 days so it carries over
                    trackingSignal.UpdatePayload(newPayload);
                    freshKeys.Add(pbKey); // Keep open, just not firing yet
                }
            }
            // If not Critical and there's an open signal, it will be auto-resolved below
        }

        // --- Auto-resolve open signals whose key is no longer in fresh set ---
        foreach (var (key, signal) in openByKey)
        {
            if (!freshKeys.Contains(key))
            {
                signal.Resolve(
                    new UserId(Guid.Parse("00000000-0000-0000-0000-000000000001")), // system
                    "Auto-resolved: condition no longer detected by compliance evaluator.",
                    now);
                autoResolved++;
                EmitAudit(repository, signal, "compliance.auto-resolved", now, auditProvenance);
            }
        }

        await signalRepository.SaveChangesAsync(ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(new EvaluateComplianceResult(opened, refreshed, autoResolved));
    }

    /// <summary>
    /// Carries the forensic-provenance trio (<c>app_version</c> +
    /// <c>device_id</c> + <c>ip_hash</c>) into every <see cref="EmitAudit"/>
    /// call so the static helper can stamp each <see cref="AuditEvent"/> row
    /// with the same context the handler received from its caller.
    /// </summary>
    private sealed record AuditProvenance(string AppVersion, string DeviceId, string IpHash);

    private static void EmitAudit(
        IShramSafalRepository repository,
        ComplianceSignal signal,
        string action,
        DateTime now,
        AuditProvenance provenance)
    {
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create. The system actor
        // user id remains the all-zeros sentinel (the rule is "no human"),
        // but the forensic provenance trio is inherited from the command:
        // HTTP path → real X-Device-Id / IP hash; cron path → ("worker",
        // "sha256:worker") via AuditContextAccessor.WorkerClaims().
        var audit = AuditEventFactory.Create(
            entityType: "ComplianceSignal",
            entityId: signal.Id,
            action: action,
            actorUserId: Guid.Parse("00000000-0000-0000-0000-000000000001"), // system actor
            actorRole: "system",
            payload: new
            {
                signalId = signal.Id,
                ruleCode = signal.RuleCode,
                severity = signal.Severity.ToString(),
                plotId = signal.PlotId,
                cropCycleId = signal.CropCycleId
            },
            farmId: (Guid)signal.FarmId,
            clientCommandId: null,
            appVersion: provenance.AppVersion,
            deviceId: provenance.DeviceId,
            ipHash: provenance.IpHash,
            sourceAiJobId: null);

        _ = repository.AddAuditEventAsync(audit);
    }
}
