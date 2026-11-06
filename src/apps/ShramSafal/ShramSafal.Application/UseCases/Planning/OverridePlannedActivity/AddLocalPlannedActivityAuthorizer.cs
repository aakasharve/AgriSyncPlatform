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
/// <para><b>spec: plr-d10 lane L8b-1 (founder D-73).</b> The rule is now <see cref="Services.ScheduleChangeGate"/>: the
/// primary owner, or a seat holding PlanWork ("कामाचं नियोजन करणे"). The role wording above describes the rule it replaced
/// (a मुकादम-or-above label), kept for the record; a label grants nothing (D-26).</para>
/// </summary>
public sealed class AddLocalPlannedActivityAuthorizer : IAuthorizationCheck<AddLocalPlannedActivityCommand>
{
    private readonly IShramSafalRepository _repository;
    private readonly AgriSync.BuildingBlocks.Abstractions.IClock _clock;

    // lane L8b-1 fix round 1 (review L6) — the authority is judged on the injected clock, as in the handler body.
    public AddLocalPlannedActivityAuthorizer(IShramSafalRepository repository, AgriSync.BuildingBlocks.Abstractions.IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    public async Task<Result> AuthorizeAsync(AddLocalPlannedActivityCommand command, CancellationToken ct)
    {
        // spec: plr-d10 lane L8b-1 (founder D-73) — the primary owner, or a seat holding PlanWork (never a label, D-26).
        // Fix round 1 (review H1, E4): first, the season the step goes into must be the named farm's (another farm's, or
        // none, is CropCycleNotFound); the authority is then asked on that farm, then the plot rule.
        return await Services.ScheduleChangeGate.RefusePlannedWorkAsync(
                _repository, command.FarmId, command.CropCycleId, command.CallerUserId, _clock.UtcNow,
                ShramSafalErrors.CropCycleNotFound, ct) is { } refused
            ? Result.Failure(refused)
            : Result.Success();
    }
}
