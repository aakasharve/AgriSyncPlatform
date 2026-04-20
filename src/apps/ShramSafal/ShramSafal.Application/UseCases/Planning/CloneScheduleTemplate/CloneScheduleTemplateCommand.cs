using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

public sealed record CloneScheduleTemplateCommand(
    Guid SourceTemplateId,
    Guid NewTemplateId,
    Guid CallerUserId,
    TenantScope NewScope,
    string Reason,
    string? ClientCommandId);
