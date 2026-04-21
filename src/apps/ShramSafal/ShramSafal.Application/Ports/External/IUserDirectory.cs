namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Read-only cross-module port for resolving user display names.
/// Backed by a raw SQL query against public.users — no User.Infrastructure project reference.
/// </summary>
public interface IUserDirectory
{
    Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesAsync(
        IEnumerable<Guid> userIds,
        CancellationToken ct = default);
}
