using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.CorrectCostEntry;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CorrectCostEntry): caller-shape +
/// payload-shape validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three gates extracted:
/// <list type="number">
/// <item>Empty <see cref="CorrectCostEntryCommand.CostEntryId"/> /
/// <see cref="CorrectCostEntryCommand.CorrectedByUserId"/> or whitespace
/// <see cref="CorrectCostEntryCommand.Reason"/> →
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item><see cref="CorrectCostEntryCommand.CorrectedAmount"/> &lt;= 0
/// or &gt; 999_999_999 →
/// <c>ShramSafal.InvalidAmount</c> (Validation kind, dynamic message
/// reused from the body's pre-rollout helper).</item>
/// <item>Explicit-but-empty <see cref="CorrectCostEntryCommand.FinanceCorrectionId"/>
/// → <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns: cost-entry existence (CostEntryNotFound),
/// owner-tier role on the entry's farm (Forbidden — both also extracted
/// into <see cref="CorrectCostEntryAuthorizer"/>), entitlement gate,
/// FinanceCorrection aggregate creation, audit, save, analytics.
/// </para>
/// </summary>
public sealed class CorrectCostEntryValidator : IValidator<CorrectCostEntryCommand>
{
    private const decimal MaxSupportedAmount = 999_999_999m;

    public IEnumerable<Error> Validate(CorrectCostEntryCommand command)
    {
        if (command.CostEntryId == Guid.Empty
            || command.CorrectedByUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.Reason))
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.CorrectedAmount <= 0 || command.CorrectedAmount > MaxSupportedAmount)
        {
            yield return Error.Validation(
                "ShramSafal.InvalidAmount",
                "Amount must be greater than zero and no more than 999999999.");
            yield break;
        }

        if (command.FinanceCorrectionId.HasValue && command.FinanceCorrectionId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
