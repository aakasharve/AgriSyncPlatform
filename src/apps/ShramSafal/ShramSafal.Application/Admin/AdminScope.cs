using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.Admin;

/// <summary>
/// The caller's resolved admin scope for the currently-selected active org.
/// Every admin endpoint handler takes one of these as its first authorization
/// input — handlers never read claims or config directly.
/// </summary>
public sealed record AdminScope(
    Guid OrganizationId,
    OrganizationType OrganizationType,
    OrganizationRole OrganizationRole,
    IReadOnlyList<ModuleEntitlement> Modules,
    bool IsPlatformAdmin)
{
    public bool CanRead(string moduleKey)
        => Modules.Any(m => m.ModuleKey == moduleKey && m.CanRead);

    public bool CanWrite(string moduleKey)
        => Modules.Any(m => m.ModuleKey == moduleKey && m.CanWrite);

    public bool CanExport(string moduleKey)
        => Modules.Any(m => m.ModuleKey == moduleKey && m.CanExport);
}
