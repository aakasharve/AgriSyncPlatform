namespace ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;

public sealed record PublishScheduleTemplateCommand(
    Guid TemplateId,
    Guid CallerUserId,
    string? ClientCommandId);
