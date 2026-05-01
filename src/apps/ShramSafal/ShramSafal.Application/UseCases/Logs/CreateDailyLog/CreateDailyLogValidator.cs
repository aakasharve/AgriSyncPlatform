using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

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
/// <see cref="CreateDailyLogCommand.PlotId"/>,
/// <see cref="CreateDailyLogCommand.CropCycleId"/>,
/// <see cref="CreateDailyLogCommand.RequestedByUserId"/>,
/// <see cref="CreateDailyLogCommand.OperatorUserId"/> is empty.</item>
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
            || command.PlotId == Guid.Empty
            || command.CropCycleId == Guid.Empty
            || command.RequestedByUserId == Guid.Empty
            || command.OperatorUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.DailyLogId.HasValue && command.DailyLogId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
