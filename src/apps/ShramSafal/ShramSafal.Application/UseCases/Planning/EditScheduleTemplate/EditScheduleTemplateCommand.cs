using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;

public sealed record EditScheduleTemplateCommand(
    Guid SourceTemplateId,
    Guid NewTemplateId,
    Guid CallerUserId,
    /// <summary>
    /// The highest AppRole the caller holds on any active farm membership.
    /// Supplied by the API layer from the authenticated JWT/session.
    /// </summary>
    AppRole CallerRole,
    string? NewName,
    string? NewStage,
    string? ClientCommandId);
