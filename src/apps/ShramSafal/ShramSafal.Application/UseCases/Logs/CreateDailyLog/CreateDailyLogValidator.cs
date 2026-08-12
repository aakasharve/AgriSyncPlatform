using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateDailyLog): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two gates are extracted, both yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item>Any of <see cref="CreateDailyLogCommand.FarmId"/>,
/// <see cref="CreateDailyLogCommand.RequestedByUserId"/>,
/// <see cref="CreateDailyLogCommand.OperatorUserId"/> is empty — plus the
/// SCOPE-CONDITIONAL spatial shape (see the LABOUR_PHASE2 P2.2 note below).</item>
/// <item>An explicit <see cref="CreateDailyLogCommand.DailyLogId"/>
/// was supplied but is empty (null is fine — the handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// farm lookup (FarmNotFound), membership check (Forbidden) — both are
/// also extracted into <see cref="CreateDailyLogAuthorizer"/> for the
/// pipeline stage — plus entitlement gate, plot lookup +
/// farm-membership cross-check (PlotNotFound), crop-cycle lookup +
/// farm/plot cross-check (CropCycleNotFound), idempotency, audit, save,
/// analytics. The pipeline preserves the canonical
/// <c>InvalidCommand → FarmNotFound → Forbidden</c> ordering on the
/// endpoint path.
/// </para>
/// </summary>
public sealed class CreateDailyLogValidator : IValidator<CreateDailyLogCommand>
{
    public IEnumerable<Error> Validate(CreateDailyLogCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.RequestedByUserId == Guid.Empty
            || command.OperatorUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        // ── LABOUR_PHASE2 P2.2 — the spatial shape is now SCOPE-CONDITIONAL ──
        //
        // Before P2.2 this method rejected ANY command whose PlotId was empty.
        // That gate is what made a farm-scoped log impossible over HTTP, and it
        // is ASYMMETRIC: /sync/push deliberately resolves the RAW handler and
        // skips this pipeline behaviour entirely (see the header comment on
        // CreateDailyLogHandler), so the same payload failed InvalidCommand here
        // and PlotNotFound there. This validator is therefore NOT the only place
        // the rule can live — CreateDailyLogHandler enforces the equivalent
        // invariant in its body, which is the gate BOTH entry paths share.
        //
        // Plot is checked exactly as it always was, so nothing about the V1
        // shape changes.
        if (!IsSpatialShapeValid(command))
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.DailyLogId.HasValue && command.DailyLogId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }

    private static bool IsSpatialShapeValid(CreateDailyLogCommand command) => command.Scope switch
    {
        // One named plot and its crop cycle — the pre-P2.2 rule, verbatim.
        // A supplied PlotIds set is allowed only if it agrees with PlotId; we do
        // not silently prefer one over the other.
        DailyLogScope.Plot =>
            command.PlotId is { } plotId
            && plotId != Guid.Empty
            && command.CropCycleId is { } cropCycleId
            && cropCycleId != Guid.Empty
            && (command.PlotIds is null
                || (command.PlotIds.Count == 1 && command.PlotIds[0] == plotId)),

        // Two or more DISTINCT real plots, and no single-plot identity at all.
        // Founder decision O-1 forbids collapsing this to "the first plot", so a
        // set of one is not a multi-plot log — it is a malformed one.
        DailyLogScope.MultiPlot =>
            command.PlotId is null
            && command.CropCycleId is null
            && command.PlotIds is { Count: >= 2 }
            && command.PlotIds.All(id => id != Guid.Empty)
            && command.PlotIds.Distinct().Count() == command.PlotIds.Count,

        // संपूर्ण शेत — no plot was named, so no plot reference may be present.
        // An EMPTY set is the honest record of that; a sentinel would not be.
        DailyLogScope.Farm =>
            command.PlotId is null
            && command.CropCycleId is null
            && command.PlotIds is null or { Count: 0 },

        // An out-of-range enum value reached the command (only possible via a
        // cast). Reject rather than fall through to a plot assertion.
        _ => false,
    };
}
