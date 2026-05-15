using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;

namespace ShramSafal.Domain.Tests.Common;

/// <summary>
/// DATA_PRINCIPLE_SPINE sub-phase 01.4 — minimal IAiJobRepository test double
/// used by handler tests that don't exercise the voice-from-Confirm code path.
/// All reads return null (so the handler stamps Provenance.Manual); writes are
/// no-ops. Tests that need to verify the voice-lift path should construct an
/// AiJob in-memory and override <see cref="GetByIdAsync"/> via a derived class.
/// </summary>
internal class NullAiJobRepository : IAiJobRepository
{
    public virtual Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
        => Task.FromResult<AiJob?>(null);

    public virtual Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default)
        => Task.FromResult<AiJob?>(null);

    public Task AddAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;

    public Task UpdateAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;

    public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default)
        => Task.FromResult(AiProviderConfig.CreateDefault());

    public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default)
        => Task.CompletedTask;

    public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default)
        => Task.FromResult(new List<AiJob>());

    public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default)
        => Task.FromResult(new Dictionary<AiProviderType, int>());

    public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default)
        => Task.FromResult(new Dictionary<AiProviderType, int>());
}
