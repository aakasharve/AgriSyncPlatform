using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.GetAiDashboard;

public sealed class GetAiDashboardHandler(IAiJobRepository repository)
{
    public async Task<Result<AiDashboardDto>> HandleAsync(
        GetAiDashboardQuery query,
        CancellationToken ct = default)
    {
        if (query.RecentJobsLimit <= 0)
        {
            return Result.Failure<AiDashboardDto>(ShramSafalErrors.InvalidCommand);
        }

        var since = query.SinceUtc ?? DateTime.UtcNow.AddDays(-7);
        var recentJobsLimit = Math.Clamp(query.RecentJobsLimit, 1, 100);

        var successes = await repository.GetSuccessCountByProviderAsync(since, ct);
        var failures = await repository.GetFailureCountByProviderAsync(since, ct);
        var recentJobs = await repository.GetRecentJobsAsync(recentJobsLimit, null, ct);
        var config = await repository.GetProviderConfigAsync(ct);

        var providerStats = Enum
            .GetValues<AiProviderType>()
            .ToDictionary(
                provider => provider.ToString(),
                provider => new ProviderStatsDto(
                    successes.GetValueOrDefault(provider, 0),
                    failures.GetValueOrDefault(provider, 0)),
                StringComparer.Ordinal);

        var successMap = providerStats.ToDictionary(
            item => item.Key,
            item => item.Value.SuccessCount,
            StringComparer.Ordinal);

        var failureMap = providerStats.ToDictionary(
            item => item.Key,
            item => item.Value.FailureCount,
            StringComparer.Ordinal);

        var dashboard = new AiDashboardDto(
            ToDto(config),
            providerStats,
            successMap,
            failureMap,
            since,
            recentJobs
                .Select(job => new RecentAiJobDto(
                    job.Id,
                    job.OperationType.ToString(),
                    job.Status.ToString(),
                    job.CreatedAtUtc,
                    job.CompletedAtUtc,
                    job.Attempts
                        .OrderBy(attempt => attempt.AttemptNumber)
                        .Select(attempt => attempt.Provider.ToString())
                        .Distinct(StringComparer.Ordinal)
                        .ToArray()))
                .ToList());

        return Result.Success(dashboard);
    }

    private static AiProviderConfigDto ToDto(AiProviderConfig config)
    {
        return new AiProviderConfigDto(
            config.Id,
            config.DefaultProvider.ToString(),
            config.FallbackEnabled,
            config.IsAiProcessingDisabled,
            config.MaxRetries,
            config.CircuitBreakerThreshold,
            config.CircuitBreakerResetSeconds,
            config.VoiceConfidenceThreshold,
            config.ReceiptConfidenceThreshold,
            config.VoiceProvider?.ToString(),
            config.ReceiptProvider?.ToString(),
            config.PattiProvider?.ToString(),
            config.ModifiedAtUtc,
            config.ModifiedByUserId);
    }
}
