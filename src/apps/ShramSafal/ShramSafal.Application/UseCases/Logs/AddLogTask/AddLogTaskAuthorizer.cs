using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddLogTask): membership authorization
/// (caller is a member of the log's farm) moves OUT of the handler
/// body into the <see cref="AuthorizationBehavior{TCommand,TResult}"/>
/// pipeline stage.
///
/// <para>
/// Unlike <c>VerifyLogAuthorizer</c>, which delegates to
/// <c>IAuthorizationEnforcer.EnsureCanVerify</c> (an existing enforcer
/// method matching the strict owner-tier rule), no enforcer method
/// matches "any member of the log's farm" exactly. Rather than extend
/// <c>IAuthorizationEnforcer</c> with a new method (and cascade the
/// change to ~5 test stubs), this authorizer takes the repository
/// directly and inlines the two-step check: log lookup → membership
/// existence. EF's first-level cache makes the body's defense-in-depth
/// re-lookup ~free in the pipeline-consumer path.
/// </para>
///
/// <para>
/// Error contract preserves the canonical ordering surfaced by the
/// handler body:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.DailyLogNotFound"/> when the log
/// id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not a member of the log's farm.</item>
/// </list>
/// </para>
/// </summary>
public sealed class AddLogTaskAuthorizer : IAuthorizationCheck<AddLogTaskCommand>
{
    private readonly IShramSafalRepository _repository;

    public AddLogTaskAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(AddLogTaskCommand command, CancellationToken ct)
    {
        var log = await _repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure(ShramSafalErrors.DailyLogNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(log.FarmId, command.ActorUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
