using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class AiJobRepository(ShramSafalDbContext db) : IAiJobRepository
{
    public async Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(idempotencyKey))
        {
            return null;
        }

        return await db.AiJobs
            .AsSplitQuery()
            .Include(x => x.Attempts)
            .FirstOrDefaultAsync(x => x.IdempotencyKey == idempotencyKey.Trim(), ct);
    }

    public async Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default)
    {
        if (jobId == Guid.Empty)
        {
            return null;
        }

        return await db.AiJobs
            .AsSplitQuery()
            .Include(x => x.Attempts)
            .FirstOrDefaultAsync(x => x.Id == jobId, ct);
    }

    public async Task AddAsync(AiJob job, CancellationToken ct = default)
    {
        await db.AiJobs.AddAsync(job, ct);
    }

    public Task UpdateAsync(AiJob job, CancellationToken ct = default)
    {
        db.AiJobs.Update(job);
        return Task.CompletedTask;
    }

    public async Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default)
    {
        var config = await db.AiProviderConfigs
            .OrderByDescending(x => x.ModifiedAtUtc)
            .FirstOrDefaultAsync(ct);

        if (config is not null)
        {
            return config;
        }

        config = AiProviderConfig.CreateDefault();
        await db.AiProviderConfigs.AddAsync(config, ct);
        await db.SaveChangesAsync(ct);
        return config;
    }

    public async Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default)
    {
        var existing = await db.AiProviderConfigs
            .AsTracking()
            .FirstOrDefaultAsync(x => x.Id == config.Id, ct);

        if (existing is null)
        {
            await db.AiProviderConfigs.AddAsync(config, ct);
            return;
        }

        db.Entry(existing).CurrentValues.SetValues(config);
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }

    public async Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default)
    {
        var effectiveLimit = Math.Clamp(limit, 1, 200);

        var query = db.AiJobs
            .AsNoTracking()
            .AsSplitQuery()
            .Include(x => x.Attempts)
            .OrderByDescending(x => x.CreatedAtUtc)
            .AsQueryable();

        if (operationType.HasValue)
        {
            query = query.Where(x => x.OperationType == operationType.Value);
        }

        return await query.Take(effectiveLimit).ToListAsync(ct);
    }

    public async Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default)
    {
        var grouped = await db.AiJobAttempts
            .AsNoTracking()
            .Where(x => x.AttemptedAtUtc >= since && x.IsSuccess)
            .GroupBy(x => x.Provider)
            .Select(x => new { Provider = x.Key, Count = x.Count() })
            .ToListAsync(ct);

        var result = Enum
            .GetValues<AiProviderType>()
            .ToDictionary(provider => provider, _ => 0);

        foreach (var row in grouped)
        {
            result[row.Provider] = row.Count;
        }

        return result;
    }

    public async Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default)
    {
        var grouped = await db.AiJobAttempts
            .AsNoTracking()
            .Where(x => x.AttemptedAtUtc >= since && !x.IsSuccess)
            .GroupBy(x => x.Provider)
            .Select(x => new { Provider = x.Key, Count = x.Count() })
            .ToListAsync(ct);

        var result = Enum
            .GetValues<AiProviderType>()
            .ToDictionary(provider => provider, _ => 0);

        foreach (var row in grouped)
        {
            result[row.Provider] = row.Count;
        }

        return result;
    }
}
