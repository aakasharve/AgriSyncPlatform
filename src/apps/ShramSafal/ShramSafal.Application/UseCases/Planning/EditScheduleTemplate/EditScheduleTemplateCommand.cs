namespace ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;

public sealed record EditScheduleTemplateCommand(
    Guid SourceTemplateId,
    Guid NewTemplateId,
    Guid CallerUserId,
    string? NewName,
    string? NewStage,
    string? ClientCommandId);
