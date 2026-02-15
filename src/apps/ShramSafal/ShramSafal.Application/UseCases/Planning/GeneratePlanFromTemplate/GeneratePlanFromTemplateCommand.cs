namespace ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;

public sealed record GeneratePlanFromTemplateCommand(
    Guid CropCycleId,
    string TemplateName,
    string Stage,
    DateOnly PlanStartDate,
    IReadOnlyList<TemplateActivityInput> Activities);

public sealed record TemplateActivityInput(string ActivityName, int OffsetDays);

