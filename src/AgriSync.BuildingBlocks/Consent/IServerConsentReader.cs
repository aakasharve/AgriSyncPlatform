// spec: data-principle-spine-2026-05-05/06.3
namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — port the
/// <see cref="ConsentEnforcer"/> uses to fetch the authoritative server
/// consent state at enforcement time. Lives in BuildingBlocks (not
/// ShramSafal) because BB cannot depend on Domain — the adapter that
/// translates <c>UserConsentState</c> into <see cref="ConsentClaims"/>
/// is registered in <c>ShramSafal.Api.DependencyInjection</c> per the
/// hexagonal-architecture inversion.
///
/// <para>
/// Returns <c>null</c> when the user has no consent row yet (default
/// state: all-false). Callers (the enforcer) treat null as the
/// default-deny state.
/// </para>
/// </summary>
public interface IServerConsentReader
{
    Task<ConsentClaims?> GetServerConsentAsync(Guid userId, CancellationToken ct);
}
