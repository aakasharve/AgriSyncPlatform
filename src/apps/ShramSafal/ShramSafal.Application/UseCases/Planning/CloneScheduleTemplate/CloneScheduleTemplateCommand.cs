using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

public sealed record CloneScheduleTemplateCommand(
    Guid SourceTemplateId,
    Guid NewTemplateId,
    Guid CallerUserId,
    /// <summary>
    /// The highest AppRole the caller holds on any active farm membership.
    /// Supplied by the API layer from the authenticated JWT/session.
    /// </summary>
    AppRole CallerRole,
    TenantScope NewScope,
    string Reason,
    string? ClientCommandId);
