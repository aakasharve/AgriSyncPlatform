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

    Task<OpsErrorsPageDto> GetErrorsPagedAsync(
        int page, int pageSize,
        string? endpoint, DateTime? since,
        CancellationToken ct = default);

    Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default);
}
