// spec: data-principle-spine-2026-05-05/05.2
namespace AgriSync.BuildingBlocks.Security;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.2 — dev/CI stub registered
/// when <c>TenantDek:MasterKeyId</c> is missing in non-Production
/// environments. Mirrors the Phase 04 <c>IpHasher</c> /
/// <c>ShramSafalDb_Migration</c> recovery pattern: do NOT fail-fast at
/// boot just because a prod-only secret is absent (Phase 04 burned twice
/// on that — e2bbeed and 629bc56). Throw at call-time instead so any
/// dev codepath that accidentally exercises the DEK port surfaces a
/// loud failure without bringing down the whole API.
/// <para>
/// Production wiring inside <c>Program.cs</c> sets
/// <c>TenantDek:MasterKeyId</c> from AWS SecretsManager and registers
/// <see cref="KmsTenantDekService"/> instead — this stub is unreachable
/// when the production secret is present.
/// </para>
/// </summary>
public sealed class NullTenantDekService : ITenantDekService
{
    public Task<TenantDek> IssueAsync(Guid ownerAccountId, CancellationToken ct) =>
        throw new NotSupportedException(
            "Tenant DEK service is not configured (TenantDek:MasterKeyId is empty). " +
            "Set TenantDek:MasterKeyId via AWS SecretsManager or appsettings.Development.json " +
            "to enable issuing per-tenant DEKs.");

    public Task<byte[]?> ResolveAsync(Guid ownerAccountId, string dekId, CancellationToken ct) =>
        throw new NotSupportedException(
            "Tenant DEK service is not configured (TenantDek:MasterKeyId is empty). " +
            "Set TenantDek:MasterKeyId via AWS SecretsManager or appsettings.Development.json " +
            "to enable resolving per-tenant DEKs.");
}
