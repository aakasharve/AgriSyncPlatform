using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

public interface IAiJobRepository
{
    Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default);
    Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default);
    Task AddAsync(AiJob job, CancellationToken ct = default);
    Task UpdateAsync(AiJob job, CancellationToken ct = default);
    Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default);
    Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);

    Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default);
    Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default);
    Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default);
}
