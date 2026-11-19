using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Reads the one-farm page (<c>GET /admin/farmer-health/{farmId}</c>).
/// </summary>
/// <remarks>
/// <para>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3, C21). A caller who is not a platform admin is
/// first checked against <c>mis.effective_org_farm_scope</c>; a farm outside the scope returns <c>null</c> and
/// nothing else is read. The farm's name and owner come from the audited cross-farm factory, opened once and
/// naming <paramref name="adminUserId"/>; a farm that does not exist returns <c>null</c> (404). Every other figure
/// is read on request: the farm's own rows as the app login through row-level security, and its events through the
/// analytics connection.
/// </para>
/// <para>
/// <b>Failures escape.</b> A failed read throws (the route answers 500), never an empty or zero payload; a factory
/// that can see no farm at all throws rather than answering that the farm does not exist (C5).
/// </para>
/// </remarks>
public interface IAdminFarmerHealthRepository
{
    Task<FarmerHealthDto?> GetAsync(Guid farmId, AdminScope scope, Guid adminUserId, CancellationToken ct = default);
}
