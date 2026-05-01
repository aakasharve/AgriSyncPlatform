using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.AddCostEntry;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three gate groups, in the same order the handler body originally
/// applied them so the canonical error sequence is preserved:
/// <list type="number">
/// <item><see cref="ShramSafalErrors.InvalidCommand"/> when any of
/// <see cref="AddCostEntryCommand.FarmId"/> /
/// <see cref="AddCostEntryCommand.CreatedByUserId"/> is empty,
/// <see cref="AddCostEntryCommand.Category"/> is missing or
/// whitespace, or <see cref="AddCostEntryCommand.Amount"/> is
/// non-positive.</item>
/// <item><see cref="ShramSafalErrors.UseSettleJobCardForLabourPayout"/>
/// when Category is the reserved <c>labour_payout</c> value — those
/// belong on <c>SettleJobCardPayoutHandler</c>, not this generic
/// finance endpoint.</item>
/// <item><see cref="ShramSafalErrors.InvalidCommand"/> when an
/// explicit <see cref="AddCostEntryCommand.CostEntryId"/> was
/// supplied but is empty (null is fine — the handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// Yield-break after each gate so the most-significant error fires
/// alone and the endpoint's status mapping picks the right code.
/// I/O-bound checks (FarmNotFound, Forbidden, PlotNotFound,
/// CropCycleNotFound, entitlement gate, duplicate detection) stay in
/// <see cref="AddCostEntryAuthorizer"/> + the handler body.
/// </para>
/// </summary>
public sealed class AddCostEntryValidator : IValidator<AddCostEntryCommand>
{
    public IEnumerable<Error> Validate(AddCostEntryCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.CreatedByUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.Category)
            || command.Amount <= 0)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        // Routing rule: labour-payout cost entries must go through
        // SettleJobCardPayoutHandler, which links the payout to the
        // verified-for-payout JobCard. Plain AddCostEntry would create
        // a finance row without that linkage; reject loudly.
        if (command.Category.Trim().Equals("labour_payout", StringComparison.OrdinalIgnoreCase))
        {
            yield return ShramSafalErrors.UseSettleJobCardForLabourPayout;
            yield break;
        }

        if (command.CostEntryId.HasValue && command.CostEntryId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
