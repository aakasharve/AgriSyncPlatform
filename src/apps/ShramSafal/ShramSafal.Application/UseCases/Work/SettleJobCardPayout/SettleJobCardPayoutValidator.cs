using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.SettleJobCardPayout;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (SettleJobCardPayout): caller-shape +
/// payout-amount + currency-code validation moves OUT of the handler
/// body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Four caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="SettleJobCardPayoutCommand.JobCardId"/> is empty.</item>
/// <item><see cref="SettleJobCardPayoutCommand.CallerUserId"/> is empty.</item>
/// <item><see cref="SettleJobCardPayoutCommand.ActualPayoutAmount"/>
/// is non-positive — pre-empts the body's
/// <c>CostEntry.CreateLabourPayout</c> argument check (which surfaces
/// the same InvalidCommand from the catch block).</item>
/// <item><see cref="SettleJobCardPayoutCommand.ActualPayoutCurrencyCode"/>
/// is null/whitespace — same pre-emption rationale.</item>
/// </list>
/// </para>
///
/// <para>
/// Substantive checks remain in the body (all I/O-state-bound):
/// <list type="bullet">
/// <item>Job-card existence
/// (<see cref="ShramSafalErrors.JobCardNotFound"/>) — also pre-empted
/// by the authorizer for the canonical pipeline path.</item>
/// <item>Status == VerifiedForPayout
/// (<see cref="ShramSafalErrors.JobCardInvalidState"/>).</item>
/// <item>Caller role resolution + Owner-tier eligibility
/// (<see cref="ShramSafalErrors.Forbidden"/> /
/// <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>).</item>
/// </list>
/// </para>
/// </summary>
public sealed class SettleJobCardPayoutValidator : IValidator<SettleJobCardPayoutCommand>
{
    public IEnumerable<Error> Validate(SettleJobCardPayoutCommand command)
    {
        if (command.JobCardId == Guid.Empty
            || command.CallerUserId.Value == Guid.Empty
            || command.ActualPayoutAmount <= 0m
            || string.IsNullOrWhiteSpace(command.ActualPayoutCurrencyCode))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
