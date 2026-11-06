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
/// <b>Done in plr-d10 lane L8b-1 fix round 1 (review H1, E4):</b> the step's season must be the supplied farm's
/// (<see cref="Services.ScheduleChangeGate.RefusePlannedWorkAsync"/>), else <see cref="ShramSafalErrors.PlannedActivityNotFound"/>.
/// </para>
/// <para><b>spec: plr-d10 lane L8b-1 (founder D-73).</b> The rule is now <see cref="Services.ScheduleChangeGate"/>: the
/// primary owner, or a seat holding PlanWork ("कामाचं नियोजन करणे"). The role wording above describes the rule it replaced
/// (a मुकादम-or-above label), kept for the record; a label grants nothing (D-26).</para>
/// </summary>
public sealed class OverridePlannedActivityAuthorizer : IAuthorizationCheck<OverridePlannedActivityCommand>
{
    private readonly IShramSafalRepository _repository;
    private readonly AgriSync.BuildingBlocks.Abstractions.IClock _clock;

    // lane L8b-1 fix round 1 (review L6) — the authority is judged on the injected clock, as in the handler body.
    public OverridePlannedActivityAuthorizer(IShramSafalRepository repository, AgriSync.BuildingBlocks.Abstractions.IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    public async Task<Result> AuthorizeAsync(OverridePlannedActivityCommand command, CancellationToken ct)
    {
        var activity = await _repository.GetPlannedActivityByIdAsync(command.PlannedActivityId, ct);
        if (activity is null || activity.IsRemoved)
        {
            return Result.Failure(ShramSafalErrors.PlannedActivityNotFound);
        }

        // spec: plr-d10 lane L8b-1 (founder D-73) — the primary owner, or a seat holding PlanWork (never a label, D-26).
        // Fix round 1 (review H1, E4): first, the step's own season must be the named farm's (another farm's step is
        // PlannedActivityNotFound, like an unknown id); the authority is then asked on that farm, then the plot rule.
        return await Services.ScheduleChangeGate.RefusePlannedWorkAsync(
                _repository, command.FarmId, activity.CropCycleId, command.CallerUserId, _clock.UtcNow,
                ShramSafalErrors.PlannedActivityNotFound, ct) is { } refused
            ? Result.Failure(refused)
            : Result.Success();
    }
}
