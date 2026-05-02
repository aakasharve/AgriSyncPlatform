using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CancelJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CancelJobCard): job-card-existence +
/// farm-membership authorization moves OUT of the handler body into
/// the <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline
/// stage.
///
/// <para>
/// Mirrors <c>CompleteJobCardAuthorizer</c>: takes
/// <see cref="IShramSafalRepository"/> directly and runs job-card
/// lookup + membership check. The body's role-tier check
/// (PrimaryOwner/SecondaryOwner/Mukadam vs Worker) stays in the domain
/// because it's a finer-grained rule that depends on the job card's
/// current state and is enforced inside <c>JobCard.Cancel</c>.
/// </para>
///
/// <para>
/// Error contract:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.JobCardNotFound"/> when the job-card
/// id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not a member of the job card's farm. The body still surfaces the
/// same Forbidden when role resolution returns null — kept as
/// defense-in-depth for the direct-call path.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CancelJobCardAuthorizer : IAuthorizationCheck<CancelJobCardCommand>
{
    private readonly IShramSafalRepository _repository;

    public CancelJobCardAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CancelJobCardCommand command, CancellationToken ct)
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
