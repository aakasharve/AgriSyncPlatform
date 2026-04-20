using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Admin ops read-only port. Queries analytics.events directly for
/// live operational health — no materialized view lag.
/// Implementation lives in Infrastructure (AnalyticsDbContext raw SQL).
/// </summary>
public interface IAdminOpsRepository
{
    Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default);
}
