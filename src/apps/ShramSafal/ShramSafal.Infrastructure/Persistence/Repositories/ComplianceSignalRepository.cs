using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Compliance;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// CEI Phase 3 §4.6 — EF Core implementation of <see cref="IComplianceSignalRepository"/>.
/// </summary>
internal sealed class ComplianceSignalRepository(ShramSafalDbContext context) : IComplianceSignalRepository
{
    public async Task<ComplianceSignal?> FindOpenAsync(
        FarmId farmId,
        Guid plotId,
        string ruleCode,
        Guid? cropCycleId,
        CancellationToken ct = default)
    {
        return await context.ComplianceSignals
            .Where(s => s.FarmId == farmId
                && s.PlotId == plotId
                && s.RuleCode == ruleCode
                && s.CropCycleId == cropCycleId
                && s.ResolvedAtUtc == null
                && s.AcknowledgedAtUtc == null)
            .FirstOrDefaultAsync(ct);
    }

    public async Task<IReadOnlyList<ComplianceSignal>> GetOpenForFarmAsync(
        FarmId farmId,
        CancellationToken ct = default)
    {
        return await context.ComplianceSignals
            .Where(s => s.FarmId == farmId
                && s.ResolvedAtUtc == null
                && s.AcknowledgedAtUtc == null)
            .OrderByDescending(s => s.Severity)
            .ThenByDescending(s => s.LastSeenAtUtc)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<ComplianceSignal>> GetForFarmAsync(
        FarmId farmId,
        bool includeResolved,
        bool includeAcknowledged,
        CancellationToken ct = default)
    {
        var query = context.ComplianceSignals
            .Where(s => s.FarmId == farmId);

        if (!includeResolved)
            query = query.Where(s => s.ResolvedAtUtc == null);

        if (!includeAcknowledged)
            query = query.Where(s => s.AcknowledgedAtUtc == null);

        return await query
            .OrderByDescending(s => s.Severity)
            .ThenByDescending(s => s.LastSeenAtUtc)
            .ToListAsync(ct);
    }

    public async Task<ComplianceSignal?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        if (id == Guid.Empty) return null;
        return await context.ComplianceSignals.FindAsync([id], ct);
    }

    public async Task<IReadOnlyList<ComplianceSignal>> GetSinceCursorAsync(
        FarmId farmId,
        DateTime cursor,
        CancellationToken ct = default)
    {
        return await context.ComplianceSignals
            .Where(s => s.FarmId == farmId && s.LastSeenAtUtc > cursor)
            .OrderBy(s => s.LastSeenAtUtc)
            .ToListAsync(ct);
    }

    public void Add(ComplianceSignal signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        context.ComplianceSignals.Add(signal);
    }

    public async Task<DateTime?> GetLatestEvaluationTimeAsync(FarmId farmId, CancellationToken ct = default)
    {
        var latest = await context.ComplianceSignals
            .Where(s => s.FarmId == farmId)
            .MaxAsync(s => (DateTime?)s.LastSeenAtUtc, ct);

        return latest;
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => context.SaveChangesAsync(ct);
}
