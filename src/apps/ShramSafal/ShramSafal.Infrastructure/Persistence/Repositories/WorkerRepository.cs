using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IWorkerRepository"/> for
/// Work Trust Ledger v0.
/// </summary>
/// <remarks>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>.
/// </remarks>
internal sealed class WorkerRepository(ShramSafalDbContext context) : IWorkerRepository
{
    public Task<Worker?> FindByNormalizedNameAsync(FarmId farmId, string normalized, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(normalized);

        return context.Workers
            .Where(w => w.FarmId == farmId && w.Name.Normalized == normalized)
            .FirstOrDefaultAsync(ct);
    }

    public void Add(Worker worker)
    {
        ArgumentNullException.ThrowIfNull(worker);
        context.Workers.Add(worker);
    }

    public void AddAssignment(WorkerAssignment assignment)
    {
        ArgumentNullException.ThrowIfNull(assignment);
        context.WorkerAssignments.Add(assignment);
    }

    public async Task<IReadOnlyList<Worker>> GetTopByAssignmentCountAsync(FarmId farmId, int limit, CancellationToken ct = default)
    {
        if (limit <= 0)
        {
            return Array.Empty<Worker>();
        }

        return await context.Workers
            .Where(w => w.FarmId == farmId)
            .OrderByDescending(w => w.AssignmentCount)
            .ThenBy(w => w.FirstSeenUtc)
            .Take(limit)
            .ToListAsync(ct);
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => context.SaveChangesAsync(ct);
}
