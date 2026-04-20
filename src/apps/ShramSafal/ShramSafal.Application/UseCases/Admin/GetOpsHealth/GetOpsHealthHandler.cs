using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetOpsHealth;

/// <summary>
/// Admin ops health — queries analytics.events directly for real-time
/// operational visibility. No nightly refresh lag.
///
/// Admin authorization is enforced entirely at the endpoint layer via
/// the "admin" role claim (same pattern as GetAiDashboardHandler).
/// The handler itself is a pure data assembler.
/// </summary>
public sealed class GetOpsHealthHandler(IAdminOpsRepository opsRepo)
{
    public async Task<Result<AdminOpsHealthDto>> HandleAsync(
        GetOpsHealthQuery query,
        CancellationToken ct = default) =>
        Result.Success(await opsRepo.GetOpsHealthAsync(ct));
}
