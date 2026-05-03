using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddLocalPlannedActivity): authorization
/// moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand}"/> pipeline stage.
///
/// <para>
/// Locally-adding a planned activity is a Mukadam-or-higher operation
/// on the supplied farm. Unlike Override / Remove, there is no pre-
/// existing aggregate to load — the command creates a new row — so the
/// authorizer is a single role-tier check. Returns
/// <see cref="ShramSafalErrors.Forbidden"/> when the caller is below
/// Mukadam.
/// </para>
///
/// <para>
/// Combined with <see cref="AddLocalPlannedActivityValidator"/> the
/// canonical pipeline ordering is
/// <c>InvalidCommand → Forbidden → (body's idempotency / persist /
/// audit / save)</c>.
/// </para>
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly (mirrors
/// <c>OverridePlannedActivityAuthorizer</c>) — the existing role-lookup
/// port already returns the right shape and we want to preserve the
/// "Mukadam-tier" semantics verbatim from the handler body.
/// </para>
/// </summary>
public sealed class AddLocalPlannedActivityAuthorizer : IAuthorizationCheck<AddLocalPlannedActivityCommand>
{
    private readonly IShramSafalRepository _repository;

    public AddLocalPlannedActivityAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(AddLocalPlannedActivityCommand command, CancellationToken ct)
    {
        var role = await _repository.GetUserRoleForFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (role is null || role < AppRole.Mukadam)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
