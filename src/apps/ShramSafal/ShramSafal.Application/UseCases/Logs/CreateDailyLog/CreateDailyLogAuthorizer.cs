using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateDailyLog): farm-existence + farm-
/// membership authorization moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Like <c>AddLogTaskAuthorizer</c>, this authorizer takes
/// <see cref="IShramSafalRepository"/> directly rather than
/// delegating to <see cref="IAuthorizationEnforcer"/>. No enforcer
/// method matches "load farm by id, then check membership"; adding one
/// would cascade to ~5 test stubs and is deferred. EF's first-level
/// cache makes the body's defense-in-depth re-lookup effectively free
/// in the pipeline-consumer path.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.FarmNotFound"/> when the farm id
/// resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the operator is
/// not a member of the target farm.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CreateDailyLogAuthorizer : IAuthorizationCheck<CreateDailyLogCommand>
{
    private readonly IShramSafalRepository _repository;

    public CreateDailyLogAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CreateDailyLogCommand command, CancellationToken ct)
    {
        var farm = await _repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure(ShramSafalErrors.FarmNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(command.FarmId, command.OperatorUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
