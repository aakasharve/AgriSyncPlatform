using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.StartJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (StartJobCard): job-card-existence +
/// farm-membership authorization moves OUT of the handler body into
/// the <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline
/// stage.
///
/// <para>
/// Mirrors <c>CompleteJobCardAuthorizer</c> exactly — the caller must
/// be a member of the job card's farm. The body's
/// <c>JobCard.Start</c> call enforces the strict "only the assigned
/// worker may start" invariant (an aggregate-state check that
/// surfaces as <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>).
/// We don't pre-empt that check here because membership is a
/// strictly weaker requirement than "is the assigned worker" — the
/// authorizer correctly admits all members and lets the aggregate
/// reject the precise role mismatch.
/// </para>
///
/// <para>
/// Like <c>AddLogTaskAuthorizer</c>, this authorizer takes
/// <see cref="IShramSafalRepository"/> directly rather than delegating
/// to <see cref="AgriSync.BuildingBlocks.Auth.IAuthorizationEnforcer"/>.
/// No enforcer method matches "load job card → check farm
/// membership"; adding one would cascade across multiple test stubs.
/// </para>
///
/// <para>
/// Error contract:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.JobCardNotFound"/> when the
/// job-card id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not a member of the job card's farm.</item>
/// </list>
/// Combined with <see cref="StartJobCardValidator"/> the canonical
/// pipeline ordering is
/// <c>InvalidCommand → JobCardNotFound → Forbidden →
/// (body checks: idempotency / JobCardRoleNotAllowed from
/// JobCard.Start)</c>.
/// </para>
/// </summary>
public sealed class StartJobCardAuthorizer : IAuthorizationCheck<StartJobCardCommand>
{
    private readonly IShramSafalRepository _repository;

    public StartJobCardAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(StartJobCardCommand command, CancellationToken ct)
    {
        var jobCard = await _repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
        {
            return Result.Failure(ShramSafalErrors.JobCardNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
