namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

public sealed record CloneScheduleTemplateResult(
    Guid NewTemplateId,
    int Version,
    Guid? DerivedFromTemplateId);
