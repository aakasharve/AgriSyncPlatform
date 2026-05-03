using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (GeneratePlanFromTemplate): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="GeneratePlanFromTemplateCommand.ActorUserId"/> empty.</item>
/// <item><see cref="GeneratePlanFromTemplateCommand.CropCycleId"/> empty.</item>
/// <item><see cref="GeneratePlanFromTemplateCommand.TemplateName"/> blank.</item>
/// <item><see cref="GeneratePlanFromTemplateCommand.Stage"/> blank.</item>
/// <item><see cref="GeneratePlanFromTemplateCommand.Activities"/> empty.</item>
/// <item>Any item in <see cref="GeneratePlanFromTemplateCommand.Activities"/>
/// has a blank <see cref="TemplateActivityInput.ActivityName"/>.</item>
/// </list>
/// The per-activity blank-name gate is a caller-shape rule because
/// <c>ScheduleTemplate.AddActivity</c> (and the
/// <c>PlannedActivity.CreateFromTemplate</c> factory below it) treat an
/// empty activity name as <see cref="ArgumentException"/> — surfacing
/// it here as Result-typed failure preserves the existing handler's
/// semantics without I/O.
/// </para>
///
/// <para>
/// The handler body still owns crop-cycle existence (CropCycleNotFound),
/// farm-membership authorization (now redundant with the authorizer but
/// preserved as defense-in-depth for direct callers), template
/// construction, planned-activity expansion (which is intentionally
/// internal to the body — the per-activity expansion is a domain
/// concern, not a caller-shape concern), test-due-date materialisation,
/// audit, save. The endpoint (POST /plan/generate) gets the canonical
/// <c>InvalidCommand → CropCycleNotFound → Forbidden → (body)</c>
/// ordering through the pipeline.
/// </para>
/// </summary>
public sealed class GeneratePlanFromTemplateValidator : IValidator<GeneratePlanFromTemplateCommand>
{
    public IEnumerable<Error> Validate(GeneratePlanFromTemplateCommand command)
    {
        if (command.ActorUserId == Guid.Empty
            || command.CropCycleId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.TemplateName)
            || string.IsNullOrWhiteSpace(command.Stage)
            || command.Activities is null
            || command.Activities.Count == 0)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.Activities.Any(a => a is null || string.IsNullOrWhiteSpace(a.ActivityName)))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
