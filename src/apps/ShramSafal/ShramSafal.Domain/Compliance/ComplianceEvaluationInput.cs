using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Domain.Compliance;

public sealed record ComplianceEvaluationInput(
    FarmId FarmId,
    DateTime AsOfUtc,
    IReadOnlyList<PlannedActivity> PlannedActivitiesLastWeek,
    IReadOnlyList<LogTask> LogTasksLastWeek,
    IReadOnlyList<DailyLog> DailyLogs,
    IReadOnlyList<TestInstance> TestInstances,
    IReadOnlyList<Plot> Plots);
