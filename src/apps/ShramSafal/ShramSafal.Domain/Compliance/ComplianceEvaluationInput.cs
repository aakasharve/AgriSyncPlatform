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
    IReadOnlyList<Plot> Plots,
    // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2) - the two inputs of the wrong-mix rule (InputMixRule). Both are
    // optional and default to "none", so every earlier caller keeps building the same input and the rule then emits nothing.
    //   LatestContents: the latest stored content row of each log dated in the last 7 days (what he said, per saved record).
    //   AcknowledgedMixFingerprints: the fingerprints of wrong mixes already acknowledged in the last 30 days (they do not re-open).
    IReadOnlyList<DailyLogContent>? LatestContents = null,
    IReadOnlySet<string>? AcknowledgedMixFingerprints = null,
    //   MixRulesInForce: the mixing rules the wrong-mix rule judges against. null (every production caller) means
    //   MixRules.Shippable - the reviewed, sourced rules in the rule file, empty until the founder's agronomist ticks them
    //   (D-96). A test hands its own reviewed rule here; the verdict still counts only rules that are reviewed and sourced
    //   (MixVerdict.IsShippable), so an unreviewed rule placed here changes nothing.
    IReadOnlyList<ShramSafal.Domain.Inputs.MixRule>? MixRulesInForce = null);
