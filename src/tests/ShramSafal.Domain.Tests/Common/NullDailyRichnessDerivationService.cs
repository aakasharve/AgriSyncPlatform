using ShramSafal.Application.UseCases.Logs.CreateDailyLog;

namespace ShramSafal.Domain.Tests.Common;

/// <summary>No-op IDailyRichnessDerivationService for handler tests that don't
/// assert on the daily-richness recompute.</summary>
public sealed class NullDailyRichnessDerivationService : IDailyRichnessDerivationService
{
    public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.CompletedTask;
}
