using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CompleteJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CompleteJobCard): authorization moves
/// OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
/// The caller must be a member of the job card's farm.
///
/// <para>
/// Like <c>AddLogTaskAuthorizer</c>, this authorizer takes
/// <see cref="IShramSafalRepository"/> directly rather than delegating to
/// <see cref="AgriSync.BuildingBlocks.Auth.IAuthorizationEnforcer"/>. No
/// enforcer method matches "load job card → check farm membership"
/// exactly; adding one would cascade to existing test stubs. The pre-
/// fetch of the job card here is shared with the handler body via EF's
/// first-level cache in the pipeline-consumer path.
/// </para>
///
/// <para>
/// Error contract:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.JobCardNotFound"/> when the job-card
/// id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not a member of the job card's farm.</item>
/// </list>
/// Combined with <see cref="CompleteJobCardValidator"/> the canonical
/// pipeline ordering is
/// <c>InvalidCommand → JobCardNotFound → Forbidden → (body checks)</c>.
/// </para>
/// </summary>
public sealed class CompleteJobCardAuthorizer : IAuthorizationCheck<CompleteJobCardCommand>
{
    private readonly IShramSafalRepository _repository;

    public CompleteJobCardAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CompleteJobCardCommand command, CancellationToken ct)
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
