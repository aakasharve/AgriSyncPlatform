using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
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
    ILogger<EvaluateComplianceHandler> logger)
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

        // --- Run pure domain evaluator (all rules except ProtocolBreakInStage) ---
        var freshResults = ComplianceEvaluator.Evaluate(input);

        // --- Get currently-open signals for the farm ---
        var openSignals = await signalRepository.GetOpenForFarmAsync(farmId, ct);
        var openByKey = openSignals.ToDictionary(
            s => new SignalKey(s.FarmId, s.PlotId, s.RuleCode, s.CropCycleId));

        int opened = 0, refreshed = 0, autoResolved = 0;

        // Track keys that the fresh evaluation produced
        var freshKeys = new HashSet<SignalKey>();

        // --- Process standard rule results ---
        foreach (var (rule, evidence) in freshResults)
        {
            // Skip ProtocolBreakInStage — handled separately below
            if (rule.RuleCode == ComplianceRuleCode.ProtocolBreakInStage)
                continue;

            var key = new SignalKey(evidence.FarmId, evidence.PlotId, rule.RuleCode, evidence.CropCycleId);
            freshKeys.Add(key);

            if (openByKey.TryGetValue(key, out var existing))
            {
                existing.Refresh(now);
                refreshed++;
                EmitAudit(repository, existing, "compliance.refreshed", now);
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
                opened++;
                EmitAudit(repository, signal, "compliance.opened", now);
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
                        EmitAudit(repository, existing, "compliance.refreshed", now);
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
                        EmitAudit(repository, signal, "compliance.opened", now);
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
                EmitAudit(repository, signal, "compliance.auto-resolved", now);
            }
        }

        await signalRepository.SaveChangesAsync(ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(new EvaluateComplianceResult(opened, refreshed, autoResolved));
    }

    private static void EmitAudit(
        IShramSafalRepository repository,
        ComplianceSignal signal,
        string action,
        DateTime now)
    {
        var audit = AuditEvent.Create(
            farmId: (Guid?)((Guid)signal.FarmId),
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
            occurredAtUtc: now);

        _ = repository.AddAuditEventAsync(audit);
    }
}
