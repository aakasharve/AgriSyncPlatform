using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CreateJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateJobCard): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="CreateJobCardCommand.FarmId"/> is empty.</item>
/// <item><see cref="CreateJobCardCommand.PlotId"/> is empty.</item>
/// <item><see cref="CreateJobCardCommand.CallerUserId"/> is empty.</item>
/// <item><see cref="CreateJobCardCommand.LineItems"/> is null or empty
/// (extracted verbatim from the body's first guard).</item>
/// </list>
/// </para>
///
/// <para>
/// Substantive checks remain in the body (all I/O-state-bound or
/// require domain-object construction):
/// <list type="bullet">
/// <item>Caller membership/role on farm
/// (<see cref="ShramSafalErrors.Forbidden"/>) — pre-empted by the
/// authorizer for the canonical pipeline path.</item>
/// <item>Owner-tier eligibility
/// (<see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>) — pre-empted
/// by the authorizer.</item>
/// <item>Line-item field-level shape (currency code, money construction)
/// — surfaces as <see cref="ShramSafalErrors.InvalidCommand"/> from the
/// body's catch block; can't be expressed against the bare command DTO
/// without re-implementing domain construction.</item>
/// <item>JobCard.CreateDraft argument validation (PlannedDate range,
/// etc.) — same rationale.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CreateJobCardValidator : IValidator<CreateJobCardCommand>
{
    public IEnumerable<Error> Validate(CreateJobCardCommand command)
    {
        if (command.FarmId.Value == Guid.Empty
            || command.PlotId == Guid.Empty
            || command.CallerUserId.Value == Guid.Empty
            || command.LineItems is null
            || command.LineItems.Count == 0)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
