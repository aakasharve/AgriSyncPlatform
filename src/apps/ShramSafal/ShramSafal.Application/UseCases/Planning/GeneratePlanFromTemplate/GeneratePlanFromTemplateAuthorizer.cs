using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (GeneratePlanFromTemplate): authorization
/// moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Generating a plan from a template is a write op against the
/// crop-cycle's farm. Per the existing handler body, the crop cycle
/// must exist (the <see cref="ShramSafal.Domain.Crops.CropCycle.FarmId"/>
/// is the source of truth for "which farm does this plan belong to" —
/// the command does not carry FarmId, so the authorizer cannot check
/// membership without first loading the crop cycle). The authorizer
/// reproduces both checks in canonical order:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.CropCycleNotFound"/> when the
/// crop-cycle id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not a member of the crop cycle's farm. Mirrors the body's
/// <c>IsUserMemberOfFarmAsync</c> any-tier check (NOT a Mukadam-tier
/// gate; plan-generation is intentionally any-member because plans are
/// drafts that can be overridden later).</item>
/// </list>
/// Combined with <see cref="GeneratePlanFromTemplateValidator"/> the
/// canonical pipeline ordering is
/// <c>InvalidCommand → CropCycleNotFound → Forbidden → (body)</c>.
/// </para>
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly (mirrors
/// <c>CompleteJobCardAuthorizer</c> + <c>AddCostEntryAuthorizer</c>) —
/// no <c>IAuthorizationEnforcer</c> method matches "load crop cycle by
/// id, then check farm membership". EF's first-level cache makes the
/// body's defense-in-depth re-lookup effectively free in the pipeline-
/// consumer path.
/// </para>
///
/// <para>
/// Cross-aggregate note: the body fans out into a template aggregate
/// (<see cref="ShramSafal.Domain.Planning.ScheduleTemplate"/>) AND
/// many planned-activity rows. The authorizer intentionally does NOT
/// gate on those — they are constructed inside the body and there is
/// no pre-existing template to authorise against. The single farm-
/// membership check is sufficient to decide "may this caller plan on
/// this crop cycle's farm".
/// </para>
/// </summary>
public sealed class GeneratePlanFromTemplateAuthorizer : IAuthorizationCheck<GeneratePlanFromTemplateCommand>
{
    private readonly IShramSafalRepository _repository;

    public GeneratePlanFromTemplateAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(GeneratePlanFromTemplateCommand command, CancellationToken ct)
    {
        var cropCycle = await _repository.GetCropCycleByIdAsync(command.CropCycleId, ct);
        if (cropCycle is null)
        {
            return Result.Failure(ShramSafalErrors.CropCycleNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(
            (Guid)cropCycle.FarmId, command.ActorUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
