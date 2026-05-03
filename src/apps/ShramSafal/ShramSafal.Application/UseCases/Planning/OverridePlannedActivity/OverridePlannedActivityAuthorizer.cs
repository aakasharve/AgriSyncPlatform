using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (OverridePlannedActivity): authorization
/// moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand}"/> pipeline stage.
///
/// <para>
/// The plan-override domain rule is "Mukadam or higher on the planned
/// activity's farm". Per the existing handler body, the planned activity
/// must exist (and not be soft-removed) AND the caller must hold a role
/// of <see cref="AppRole.Mukadam"/> or higher on the supplied farm. The
/// authorizer reproduces both checks in canonical order:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.PlannedActivityNotFound"/> when the
/// planned-activity id resolves to nothing OR the row is already
/// soft-removed.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not at least a Mukadam on the supplied farm.</item>
/// </list>
/// Combined with <see cref="OverridePlannedActivityValidator"/> the
/// canonical pipeline ordering is
/// <c>InvalidCommand → PlannedActivityNotFound → Forbidden → (body)</c>.
/// </para>
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly (mirrors
/// <c>CompleteJobCardAuthorizer</c> + <c>AddCostEntryAuthorizer</c>) —
/// no <c>IAuthorizationEnforcer</c> method matches "load planned-
/// activity, then check Mukadam-or-higher on a separately-supplied
/// farm id". EF's first-level cache makes the body's
/// defense-in-depth re-lookup effectively free in the pipeline-consumer
/// path.
/// </para>
///
/// <para>
/// Note: the caller-supplied <c>FarmId</c> on the command may not match
/// the planned activity's farm-of-record (the planned-activity row only
/// carries <c>CropCycleId</c>, not <c>FarmId</c>, so the link is via
/// crop cycle). Treating the supplied <c>FarmId</c> as authoritative
/// preserves the existing handler-body behaviour verbatim; tightening
/// to "supplied FarmId must equal the planned-activity's farm-of-
/// record" would require a CropCycle lookup and is deliberately
/// deferred to a follow-up — consistent with the rule "preserve error
/// ordering, do not change semantics" for pipeline rollouts.
/// </para>
/// </summary>
public sealed class OverridePlannedActivityAuthorizer : IAuthorizationCheck<OverridePlannedActivityCommand>
{
    private readonly IShramSafalRepository _repository;

    public OverridePlannedActivityAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(OverridePlannedActivityCommand command, CancellationToken ct)
    {
        var activity = await _repository.GetPlannedActivityByIdAsync(command.PlannedActivityId, ct);
        if (activity is null || activity.IsRemoved)
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
