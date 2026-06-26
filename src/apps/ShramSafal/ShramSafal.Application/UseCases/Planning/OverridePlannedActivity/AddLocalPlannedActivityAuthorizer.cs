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
/// The add-local-activity domain rule is "Mukadam or higher on the
/// supplied farm". Per the existing handler body (Step 3) the only
/// authorization gate is the role check, yielding
/// <see cref="ShramSafalErrors.Forbidden"/> when the caller is not at
/// least a <see cref="AppRole.Mukadam"/> on the supplied farm.
/// </para>
///
/// <para>
/// Unlike OverridePlannedActivity / RemovePlannedActivity there is NO
/// PlannedActivityNotFound stage — the use case creates a brand-new
/// planned activity, so there is no existing row to load. Combined with
/// <see cref="AddLocalPlannedActivityValidator"/> the canonical pipeline
/// ordering is <c>InvalidCommand → Forbidden → (body)</c>.
/// </para>
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly (mirrors
/// <see cref="OverridePlannedActivityAuthorizer"/>) — no
/// <c>IAuthorizationEnforcer</c> method matches "Mukadam-or-higher on a
/// supplied farm id" exactly. The handler body keeps the same check as a
/// defense-in-depth re-lookup; EF's first-level cache makes it free on
/// the pipeline-consumer path.
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
