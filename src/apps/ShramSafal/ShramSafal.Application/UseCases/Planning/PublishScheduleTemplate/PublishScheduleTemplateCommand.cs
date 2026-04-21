using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;

public sealed record PublishScheduleTemplateCommand(
    Guid TemplateId,
    Guid CallerUserId,
    /// <summary>
    /// The highest AppRole the caller holds on any active farm membership.
    /// Supplied by the API layer from the authenticated JWT/session.
    /// </summary>
    AppRole CallerRole,
    string? ClientCommandId);
