namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlanGenerationResultDto(
    Guid TemplateId,
    Guid CropCycleId,
    string TemplateName,
    int ActivitiesGenerated,
    IReadOnlyList<PlannedActivityDto> PlannedActivities);

