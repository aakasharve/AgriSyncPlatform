using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Phase 6 — read-only port querying the mis.* materialized views.
/// Implementation lives in Infrastructure (AnalyticsDbContext raw SQL).
/// The port is intentionally separate from IShramSafalRepository because
/// the mis schema is append-only and never writes.
/// </summary>
public interface IMisReportRepository
{
    /// <summary>
    /// Returns the latest MIS snapshot for a single farm from mis.* views.
    /// Returns null if the farm has no data yet (views empty for this farmId).
    /// </summary>
    Task<FarmWeekMisDto?> GetFarmWeekMisAsync(Guid farmId, CancellationToken ct = default);
}
