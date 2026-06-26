using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (RemovePlannedActivity): authorization
/// moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand}"/> pipeline stage.
///
/// <para>
/// The plan-remove domain rule is "Mukadam or higher on the planned
/// activity's farm". Per the existing handler body the planned activity
/// must exist AND the caller must hold a role of
/// <see cref="AppRole.Mukadam"/> or higher on the supplied farm. The
/// authorizer reproduces both checks in canonical order:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.PlannedActivityNotFound"/> when the
/// planned-activity id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not at least a Mukadam on the supplied farm.</item>
/// </list>
/// Combined with <see cref="RemovePlannedActivityValidator"/> the
/// canonical pipeline ordering is
/// <c>InvalidCommand → PlannedActivityNotFound → Forbidden → (body)</c>.
/// </para>
///
/// <para>
/// Note: unlike <see cref="OverridePlannedActivityAuthorizer"/>, this
/// authorizer does NOT short-circuit on an already-soft-removed row —
/// the handler body deliberately re-applies <c>SoftRemove</c> regardless
/// (the domain method is idempotent for the soft-removed state), so
/// adding an <c>IsRemoved</c> gate here would change the error shape from
/// the existing handler-body behaviour. Preserving the verbatim
/// load-then-role ordering keeps the pipeline migration semantics-neutral.
/// </para>
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly (mirrors
/// <see cref="OverridePlannedActivityAuthorizer"/>). EF's first-level
/// cache makes the body's defense-in-depth re-lookup effectively free in
/// the pipeline-consumer path.
/// </para>
/// </summary>
public sealed class RemovePlannedActivityAuthorizer : IAuthorizationCheck<RemovePlannedActivityCommand>
{
    private readonly IShramSafalRepository _repository;

    public RemovePlannedActivityAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(RemovePlannedActivityCommand command, CancellationToken ct)
    {
        var activity = await _repository.GetPlannedActivityByIdAsync(command.PlannedActivityId, ct);
        if (activity is null)
        {
            return Result.Failure(ShramSafalErrors.PlannedActivityNotFound);
        }

        var role = await _repository.GetUserRoleForFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (role is null || role < AppRole.Mukadam)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
